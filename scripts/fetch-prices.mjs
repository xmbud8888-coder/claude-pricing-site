#!/usr/bin/env node
/**
 * 价格自动抓取 / 变更检测管线
 *
 * ⚠️ 必须从非中国大陆网络运行（apps.apple.com 会按 IP 重定向到 CN 商店，
 *    openai.com / x.ai 对部分地区有 bot 防护）。GitHub Actions 的
 *    ubuntu-latest runner（美国）即可，见 .github/workflows/refresh-prices.yml
 *
 * 做三件事：
 *  1. 抓 Apple App Store 各区页面 → 提取 Claude / ChatGPT / Grok 的内购价
 *     → 高置信匹配时直接更新 data/prices.json（regions、iosUS、max20x）
 *  2. 监测官方定价页（claude.com / developers.openai.com / docs.x.ai）
 *     → 提取价格指纹，与上次对比，变了就报警（exit 2，CI 开 issue）
 *  3. 输出 data/fetch-report.json 供人工/agent 复核
 *
 * 用法：node scripts/fetch-prices.mjs [--dry-run]
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

const APPLE_APPS = {
  claude: { id: "6473753684", slug: "claude" },
  chatgpt: { id: "6448311069", slug: "chatgpt" },
  grok: { id: "6670324846", slug: "grok" },
};
const PLAY_APPS = {
  claude: "com.anthropic.claude",
  chatgpt: "com.openai.chatgpt",
  grok: "ai.x.grok",
};
// 与 data/prices.json 中 regions[].cc 对齐
const STOREFRONTS = ["us", "jp", "pk", "ca", "ar", "eg", "au", "ph", "in", "tr", "ng", "kr", "mx", "de", "fr", "br", "gb", "dk"];
// IMF DataMapper 的 ISO3 映射（PPP 隐含换算率 PPPEX）
const CC_ISO3 = {
  us: "USA", jp: "JPN", pk: "PAK", ca: "CAN", ar: "ARG", eg: "EGY", au: "AUS", ph: "PHL",
  in: "IND", tr: "TUR", ng: "NGA", kr: "KOR", mx: "MEX", de: "DEU", fr: "FRA", br: "BRA",
  gb: "GBR", dk: "DNK",
};

// 官方定价页监测清单
const WATCH_PAGES = [
  { key: "claude-pricing", url: "https://claude.com/pricing" },
  { key: "anthropic-api-docs", url: "https://platform.claude.com/docs/en/about-claude/models/overview.md" },
  { key: "openai-api-pricing", url: "https://developers.openai.com/api/docs/pricing" },
  { key: "xai-models", url: "https://docs.x.ai/docs/models" },
];

const report = { ranAt: new Date().toISOString(), apple: {}, watch: {}, warnings: [] };

async function get(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    redirect: "follow",
  });
  return { status: res.status, url: res.url, text: await res.text() };
}

/* ---------- 1. Apple App Store 内购价 ---------- */

// 深度遍历 serialized-server-data，收集「名称 + 价格」形态的内购项。
// Apple 的数据是无键名的嵌套数组，形如 ["Claude Pro", "$19.99", ...]，
// 同时保留对象形态 {name, price} 的兼容匹配。
const MONEY_RE = /^(?:US?\$|CA\$|A\$|MX\$|R\$|HK\$|NT\$|\$|€|£|¥|₹|₩|₱|₦|₺|₨|Rs\.?\s?|EGP\s?|TRY\s?|kr\.?\s?|USD|EUR)?\s?[0-9][0-9.,\s]*(?:\s?(?:kr\.?|€|USD))?$/;
const NAME_RE = /^[\p{L}][\p{L}\p{N}\s.+&'\-–—:：]{2,59}$/u;
function scanForIAP(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    // 数组形态：相邻的 [名称, 价格] 字符串对
    for (let i = 0; i < node.length - 1; i++) {
      const a = node[i], b = node[i + 1];
      if (typeof a === "string" && typeof b === "string" &&
          NAME_RE.test(a.trim()) && MONEY_RE.test(b.trim()) && /\d/.test(b)) {
        out.push({ name: a.trim(), price: b.trim() });
      }
    }
    node.forEach(n => scanForIAP(n, out));
    return out;
  }
  const name = node.name || node.title;
  const price = node.priceFormatted || node.formattedPrice || node.price;
  if (typeof name === "string" && price != null && String(price).match(/[\d.,]/)) {
    out.push({ name: name.trim(), price: String(price).trim() });
  }
  Object.values(node).forEach(v => scanForIAP(v, out));
  return out;
}

async function fetchAppleIAP(appKey, cc) {
  const { id, slug } = APPLE_APPS[appKey];
  const url = `https://apps.apple.com/${cc}/app/${slug}/id${id}`;
  const { status, url: finalUrl, text } = await get(url);
  // 被地区重定向说明该区未上架（或抓取节点地区不对）
  if (!finalUrl.includes(`/${cc}/`)) {
    return { ok: false, reason: `redirected to ${finalUrl}（该区未上架或抓取节点地区受限）` };
  }
  if (status !== 200) return { ok: false, reason: `HTTP ${status}` };
  const m = text.match(/<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { ok: false, reason: "未找到 serialized-server-data（页面结构可能已变）" };
  try {
    const iaps = scanForIAP(JSON.parse(m[1]))
      // 过滤到订阅类条目，去噪
      .filter(x => /pro|max|plus|super|premium|month|年|月/i.test(x.name))
      .filter((x, i, arr) => arr.findIndex(y => y.name === x.name && y.price === x.price) === i);
    return { ok: true, iaps };
  } catch (e) {
    return { ok: false, reason: "JSON 解析失败: " + e.message };
  }
}

/* ---------- 1b. Google Play 内购价区间 ---------- */

// Play 商店页公开「In-app purchases X – Y per item」区间（hl=en 固定英文文案，gl 控制国家）
async function fetchPlayRange(pkg, gl) {
  const url = `https://play.google.com/store/apps/details?id=${pkg}&hl=en&gl=${gl.toUpperCase()}`;
  const { status, text } = await get(url);
  if (status !== 200) return { ok: false, reason: `HTTP ${status}` };
  if (!text.includes("In-app purchases")) return { ok: false, reason: "页面无 In-app purchases 字段" };
  // 两种文案：美区等 "X - Y per item"；欧区等 "X - Y if billed through Play"
  const m =
    text.match(/([^"<>]{1,28}?)\s+-\s+([^"<>]{1,28}?) per item/) ||
    text.match(/([^"<>]{1,28}?)\s+-\s+([^"<>]{1,28}?) if billed through Play/) ||
    text.match(/([^"<>]{1,28}?) per item/);
  if (!m) return { ok: false, reason: "未匹配到价格区间" };
  const range = m[0].replace(/\s+(per item|if billed through Play)$/, "").trim();
  return { ok: true, range };
}

/* ---------- 1c. IMF PPP 隐含换算率 ---------- */

async function fetchIMFPPP() {
  const { status, text } = await get("https://www.imf.org/external/datamapper/api/v1/PPPEX");
  if (status !== 200) return { ok: false, reason: `HTTP ${status}` };
  const data = JSON.parse(text)?.values?.PPPEX;
  if (!data) return { ok: false, reason: "响应缺少 PPPEX" };
  const year = String(new Date().getFullYear());
  const out = {};
  for (const [cc, iso3] of Object.entries(CC_ISO3)) {
    const series = data[iso3];
    if (!series) continue;
    out[cc] = series[year] ?? series[String(+year - 1)] ?? null;
  }
  return { ok: true, year, rates: out };
}

/* ---------- 2. 官方定价页变更检测 ---------- */

// 提取价格指纹：页面里所有 $ 金额 + 模型名 token，排序去重后哈希
function priceFingerprint(html) {
  const text = html.replace(/<[^>]+>/g, " ");
  const monies = [...text.matchAll(/\$\s?\d+(?:\.\d+)?/g)].map(m => m[0].replace(/\s/g, ""));
  const models = [...text.matchAll(/\b(?:gpt|claude|grok)-[a-z0-9.\-]+/gi)].map(m => m[0].toLowerCase());
  const tokens = [...new Set([...monies, ...models])].sort();
  return {
    hash: createHash("sha256").update(tokens.join("|")).digest("hex").slice(0, 16),
    tokens,
  };
}

/* ---------- 主流程 ---------- */

async function main() {
  const pricesPath = path.join(ROOT, "data", "prices.json");
  const watchPath = path.join(ROOT, "data", "watch.json");
  const prices = JSON.parse(await readFile(pricesPath, "utf-8"));
  let watch = {};
  try { watch = JSON.parse(await readFile(watchPath, "utf-8")); } catch {}

  let changed = false;
  const PLAY_ONLY = process.argv.includes("--play-only");

  // 1. Apple IAP（先跑 us 全三家 + Claude 全区）。--play-only 时跳过（Apple 需海外节点）
  if (!PLAY_ONLY) {
    for (const appKey of Object.keys(APPLE_APPS)) {
      report.apple[appKey] = {};
      const ccs = appKey === "claude" ? STOREFRONTS : ["us"];
      for (const cc of ccs) {
        try {
          report.apple[appKey][cc] = await fetchAppleIAP(appKey, cc);
        } catch (e) {
          report.apple[appKey][cc] = { ok: false, reason: e.message };
        }
        await new Promise(r => setTimeout(r, 800)); // 礼貌限速
      }
    }
  }

  // 1b. Google Play：Claude 全区区间 + ChatGPT/Grok 美区区间
  report.play = {};
  for (const [appKey, pkg] of Object.entries(PLAY_APPS)) {
    report.play[appKey] = {};
    const gls = appKey === "claude" ? STOREFRONTS : ["us"];
    for (const gl of gls) {
      try {
        report.play[appKey][gl] = await fetchPlayRange(pkg, gl);
      } catch (e) {
        report.play[appKey][gl] = { ok: false, reason: e.message };
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }
  // Play 回填：Claude 各区内购区间
  let playFilled = 0;
  for (const [gl, r] of Object.entries(report.play.claude || {})) {
    if (!r?.ok) continue;
    const region = prices.claude.regions.find(x => x.cc === gl);
    if (region && region.play !== r.range) { region.play = r.range; changed = true; }
    if (region) playFilled++;
  }
  // ChatGPT / Grok 美区 Play 区间 → 行情板块
  for (const appKey of ["chatgpt", "grok"]) {
    const r = report.play[appKey]?.us;
    if (!r?.ok) continue;
    const target = appKey === "chatgpt" ? prices.openai : prices.xai;
    target.playUS = { range: r.range, verifiedAt: new Date().toISOString().slice(0, 10), source: "play.google.com 美区商店页" };
    changed = true;
  }
  if (playFilled > 0) {
    const prov = (prices.provenance || []).find(p => p.key === "google-play");
    if (prov) {
      prov.status = "verified";
      prov.verifiedAt = new Date().toISOString().slice(0, 10);
      prov.source = `play.google.com 各区商店页直抓（${playFilled}/18 区成功）`;
    }
  }

  // 1c. IMF PPP 换算率（购买力对比用）
  if (!PLAY_ONLY) {
    try {
      const ppp = await fetchIMFPPP();
      report.imfPPP = ppp.ok ? { ok: true, year: ppp.year } : ppp;
      if (ppp.ok) {
        for (const region of prices.claude.regions) {
          if (ppp.rates[region.cc] != null) { region.pppex = +(+ppp.rates[region.cc]).toFixed(3); changed = true; }
        }
        const prov = (prices.provenance || []).find(p => p.key === "imf-ppp");
        if (prov) {
          prov.status = "verified";
          prov.verifiedAt = new Date().toISOString().slice(0, 10);
          prov.source = `IMF DataMapper API（PPPEX，${ppp.year} 年值）`;
        }
      }
    } catch (e) { report.imfPPP = { ok: false, reason: e.message }; }
  }

  // 汇率表（公开源，用于本币 → 美元折算）
  let fx = null;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const j = await res.json();
    if (j && j.rates) fx = j.rates;
  } catch (e) { report.warnings.push("汇率获取失败: " + e.message); }

  const CC_CURRENCY = {
    us: "USD", jp: "JPY", pk: "PKR", ca: "CAD", ar: "USD", eg: "EGP", au: "AUD", ph: "PHP",
    in: "INR", tr: "TRY", ng: "NGN", kr: "KRW", mx: "MXN", de: "EUR", fr: "EUR", br: "BRL",
    gb: "GBP", dk: "DKK",
  };
  const toUSD = (num, cc) => {
    if (cc === "us" || cc === "ar") return num;               // 美区/阿区以美元挂牌
    const cur = CC_CURRENCY[cc];
    return fx && fx[cur] ? +(num / fx[cur]).toFixed(2) : null;
  };
  // 月付 SKU 进对比表（排除各语言的年付标记），避免 Annual 覆盖 Monthly
  const ANNUAL_RE = /annual|yearly|\byear\b|年間|年额|연간|jährlich|annuel|anual|yıllık|årlig/i;
  const classify = name => {
    if (ANNUAL_RE.test(name)) return null;
    if (/max.*20|20x/i.test(name)) return "max20x";
    if (/max/i.test(name)) return "max5x";
    if (/pro/i.test(name)) return "pro";
    return null;
  };
  // 多币种金额解析：处理 1,234.56 / 1.234,56 / 35,000 / 2.237 等千位/小数写法
  const parseMoney = s => {
    let t = String(s).replace(/[^\d.,]/g, "").replace(/^[.,]+|[.,]+$/g, "");
    if (!t) return NaN;
    const lastDot = t.lastIndexOf("."), lastComma = t.lastIndexOf(",");
    if (lastDot >= 0 && lastComma >= 0) {
      const dec = lastDot > lastComma ? "." : ",";
      t = t.split(dec === "." ? "," : ".").join("");
      if (dec === ",") t = t.replace(",", ".");
    } else if (lastComma >= 0) {
      t = /,\d{1,2}$/.test(t) ? t.replace(",", ".") : t.split(",").join("");
    } else if (lastDot >= 0) {
      if (/\.\d{3}$/.test(t)) t = t.split(".").join("");   // 2.237 → 2237（丹麦式千位）
    }
    return parseFloat(t);
  };

  // Claude：美区 iosUS + 18 区 regions 高置信回填
  let appleFilled = 0;
  for (const cc of Object.keys(report.apple.claude || {})) {
    const r = report.apple.claude[cc];
    if (!r?.ok) continue;
    for (const iap of r.iaps) {
      // 美区年付单独记录（对比网页年付 $200）
      if (cc === "us" && /pro/i.test(iap.name) && /annual/i.test(iap.name)) {
        const n = parseMoney(iap.price);
        if (n) { prices.claude.iosUS.proAnnual = n; changed = true; }
      }
      const tier = classify(iap.name);
      if (!tier) continue;
      const num = parseMoney(iap.price);
      if (!num) continue;
      if (cc === "us") { prices.claude.iosUS[tier] = num; changed = true; appleFilled++; }
      const region = prices.claude.regions.find(x => x.cc === cc);
      if (region) {
        const usd = toUSD(num, cc);
        if (usd != null) { region[tier] = usd; changed = true; appleFilled++; }
        if (tier === "pro") {
          region.local = String(iap.price).trim();
          region.localAmount = num;   // 本币数值，供 PPP 折算（local/pppex）
          changed = true;
        }
      }
    }
  }
  // 仅当确实回填了 Apple 数据才把账本转已核验
  if (appleFilled > 0) {
    const prov = (prices.provenance || []).find(p => p.key === "appstore");
    if (prov) {
      prov.status = "verified";
      prov.verifiedAt = new Date().toISOString().slice(0, 10);
      prov.source = "apps.apple.com 各区商店页（管线直抓）+ 公开汇率折算";
    }
  }

  // 2. 定价页变更检测（--play-only 时跳过）
  let watchChanged = false;
  for (const page of PLAY_ONLY ? [] : WATCH_PAGES) {
    try {
      const { status, text } = await get(page.url);
      if (status !== 200) {
        report.watch[page.key] = { ok: false, reason: `HTTP ${status}` };
        continue;
      }
      const fp = priceFingerprint(text);
      const prev = watch[page.key];
      const diff = prev && prev.hash !== fp.hash;
      report.watch[page.key] = {
        ok: true, hash: fp.hash, changedSinceLastRun: !!diff,
        added: diff ? fp.tokens.filter(t => !prev.tokens.includes(t)) : [],
        removed: diff ? prev.tokens.filter(t => !fp.tokens.includes(t)) : [],
      };
      if (diff) watchChanged = true;
      watch[page.key] = { hash: fp.hash, tokens: fp.tokens, at: new Date().toISOString() };
    } catch (e) {
      report.watch[page.key] = { ok: false, reason: e.message };
    }
  }

  // 3. 落盘
  if (!DRY) {
    if (changed) {
      prices.updatedAt = new Date().toISOString().slice(0, 10);
      await writeFile(pricesPath, JSON.stringify(prices, null, 2) + "\n");
    }
    await mkdir(path.join(ROOT, "data"), { recursive: true });
    await writeFile(watchPath, JSON.stringify(watch, null, 2) + "\n");
    await writeFile(path.join(ROOT, "data", "fetch-report.json"), JSON.stringify(report, null, 2) + "\n");
  }

  console.log(JSON.stringify(report, null, 2));
  if (watchChanged) {
    console.error("\n⚠️ 官方定价页有变更，请人工复核 data/fetch-report.json 并更新 data/prices.json");
    process.exit(2);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
