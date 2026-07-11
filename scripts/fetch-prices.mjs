#!/usr/bin/env node
/**
 * 价格自动抓取 / 变更检测管线（配置驱动多产品版，产品清单见 data/prices.json 的 products）
 *
 * ⚠️ 必须从非中国大陆网络运行（apps.apple.com 会按 IP 重定向到 CN 商店，
 *    openai.com / x.ai 对部分地区有 bot 防护）。GitHub Actions 的
 *    ubuntu-latest runner（美国）即可，见 .github/workflows/refresh-prices.yml
 *
 * 做三件事：
 *  1. 抓 Apple App Store 各区页面 → 全产品 × 18 区内购价 → 回填 data/prices.json（appleId 缺失时自动经 iTunes Search 发现）
 *  2. 抓 Google Play 各区页面 → 全产品 × 18 区内购区间 → 回填（playPkg 缺失时按候选包名自动验证）
 *  3. 抓 IMF PPPEX + 公开汇率；监测官方定价页变更（变了 exit 2，CI 开 issue）
 *
 * 用法：node scripts/fetch-prices.mjs [--play-only] [--dry-run]
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");
const PLAY_ONLY = process.argv.includes("--play-only");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

// 产品与商店配置从 data/prices.json 的 products.*.store / tierRules 读取（配置驱动）
const ANNUAL_RE = /annual|yearly|\byear\b|年間|年额|연간|jährlich|annuel|anual|yıllık|årlig/i;

const STOREFRONTS = ["us", "jp", "pk", "ca", "ar", "eg", "au", "ph", "in", "tr", "ng", "kr", "mx", "de", "fr", "br", "gb", "dk"];
const CC_CURRENCY = {
  us: "USD", jp: "JPY", pk: "PKR", ca: "CAD", ar: "USD", eg: "EGP", au: "AUD", ph: "PHP",
  in: "INR", tr: "TRY", ng: "NGN", kr: "KRW", mx: "MXN", de: "EUR", fr: "EUR", br: "BRL",
  gb: "GBP", dk: "DKK",
};
const PPP_LOCAL_CUR = { ar: "ARS" };   // 美元挂牌但 PPPEX 为本币的区
const CC_ISO3 = {
  us: "USA", jp: "JPN", pk: "PAK", ca: "CAN", ar: "ARG", eg: "EGY", au: "AUS", ph: "PHL",
  in: "IND", tr: "TUR", ng: "NGA", kr: "KOR", mx: "MEX", de: "DEU", fr: "FRA", br: "BRA",
  gb: "GBR", dk: "DNK",
};

const WATCH_PAGES = [
  { key: "claude-pricing", url: "https://claude.com/pricing" },
  { key: "anthropic-api-docs", url: "https://platform.claude.com/docs/en/about-claude/models/overview.md" },
  { key: "openai-api-pricing", url: "https://developers.openai.com/api/docs/pricing" },
  { key: "xai-models", url: "https://docs.x.ai/docs/models" },
];

const report = { ranAt: new Date().toISOString(), apple: {}, play: {}, watch: {}, warnings: [] };
const today = () => new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    redirect: "follow",
  });
  return { status: res.status, url: res.url, text: await res.text() };
}

/* ---------- 金额解析（多币种千位/小数写法） ---------- */
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
    if (/\.\d{3}$/.test(t)) t = t.split(".").join("");
  }
  return parseFloat(t);
};

/* ---------- 1. Apple App Store 内购价 ---------- */

const MONEY_RE = /^(?:US?\$|CA\$|A\$|MX\$|R\$|HK\$|NT\$|\$|€|£|¥|₹|₩|₱|₦|₺|₨|Rs\.?\s?|EGP\s?|TRY\s?|kr\.?\s?|USD|EUR)?\s?[0-9][0-9.,\s]*(?:\s?(?:kr\.?|€|USD|원))?$/;
const NAME_RE = /^[\p{L}][\p{L}\p{N}\s.+&'\-–—:：]{2,59}$/u;

function scanForIAP(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
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

async function fetchAppleIAP(appleId, cc, keepRe) {
  const url = `https://apps.apple.com/${cc}/app/id${appleId}`;
  const { status, url: finalUrl, text } = await get(url);
  if (!finalUrl.includes(`/${cc}/`)) {
    return { ok: false, reason: `redirected to ${finalUrl}（该区未上架或抓取节点地区受限）` };
  }
  if (status !== 200) return { ok: false, reason: `HTTP ${status}` };
  const m = text.match(/<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { ok: false, reason: "未找到 serialized-server-data（页面结构可能已变）" };
  try {
    const iaps = scanForIAP(JSON.parse(m[1]))
      .filter(x => (keepRe || /pro|max|plus|super|premium|go|month|membership|会员|年|月/i).test(x.name))
      .filter((x, i, arr) => arr.findIndex(y => y.name === x.name && y.price === x.price) === i)
      .slice(0, 40);
    if (!iaps.length) {
      const probe = [...new Set([...text.matchAll(/(?:US?\$|€|£|¥|₩|₹|₺|₦|₱|₨|kr\.?|R\$)\s?[\d.,]+|[\d.,]+\s?원/g)].map(x => x[0]))].slice(0, 8);
      return { ok: true, iaps, probe };
    }
    return { ok: true, iaps };
  } catch (e) {
    return { ok: false, reason: "JSON 解析失败: " + e.message };
  }
}

/* ---------- 2. Google Play 内购价区间 ---------- */

async function fetchPlayRange(pkg, gl) {
  const url = `https://play.google.com/store/apps/details?id=${pkg}&hl=en&gl=${gl.toUpperCase()}`;
  const { status, text } = await get(url);
  if (status !== 200) return { ok: false, reason: `HTTP ${status}` };
  if (!text.includes("In-app purchases")) return { ok: false, reason: "页面无 In-app purchases 字段" };
  const m =
    text.match(/([^"<>]{1,28}?)\s+-\s+([^"<>]{1,28}?) per item/) ||
    text.match(/([^"<>]{1,28}?)\s+-\s+([^"<>]{1,28}?) if billed through Play/) ||
    text.match(/([^"<>]{1,28}?) per item/);
  if (!m) return { ok: false, reason: "未匹配到价格区间" };
  const range = m[0].replace(/\s+(per item|if billed through Play)$/, "").trim();
  return { ok: true, range };
}

/* ---------- 3. IMF PPPEX ---------- */

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

/* ---------- 4. 定价页变更指纹 ---------- */

function priceFingerprint(html) {
  const text = html.replace(/<[^>]+>/g, " ");
  const monies = [...text.matchAll(/\$\s?\d+(?:\.\d+)?/g)].map(m => m[0].replace(/\s/g, ""));
  const models = [...text.matchAll(/\b(?:gpt|claude|grok)-[a-z0-9.\-]+/gi)].map(m => m[0].toLowerCase());
  const tokens = [...new Set([...monies, ...models])].sort();
  return { hash: createHash("sha256").update(tokens.join("|")).digest("hex").slice(0, 16), tokens };
}

/* ---------- 主流程 ---------- */

async function main() {
  const pricesPath = path.join(ROOT, "data", "prices.json");
  const watchPath = path.join(ROOT, "data", "watch.json");
  const prices = JSON.parse(await readFile(pricesPath, "utf-8"));
  let watch = {};
  try { watch = JSON.parse(await readFile(watchPath, "utf-8")); } catch {}

  let changed = false;
  const setProv = (key, source) => {
    const p = (prices.provenance || []).find(x => x.key === key);
    if (p) { p.status = "verified"; p.verifiedAt = today(); if (source) p.source = source; }
  };
  const regionOf = (appKey, cc) => {
    const prod = prices.products[appKey];
    if (!prod.regions[cc]) prod.regions[cc] = {};
    return prod.regions[cc];
  };

  // 从配置构建产品清单（tierRules 字符串 → RegExp）
  const PRODUCT_KEYS = Object.keys(prices.products);
  const rulesOf = appKey =>
    (prices.products[appKey].tierRules || []).map(([re, tier]) => [new RegExp(re, "i"), tier]);

  /* ---------- 商店 ID 自动发现 ---------- */
  // Apple：iTunes Search API（需海外节点），按开发商正则确认后写回配置
  async function discoverApple(appKey) {
    const st = prices.products[appKey].store || {};
    if (st.appleId || !st.appleSearch) return;
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(st.appleSearch)}&country=us&entity=software&limit=8`;
      const { status, text } = await get(url);
      if (status !== 200) { report.warnings.push(`discoverApple(${appKey}): HTTP ${status}`); return; }
      const results = JSON.parse(text).results || [];
      const sellerRe = new RegExp(st.sellerRe || ".", "i");
      const nameRe = st.nameRe ? new RegExp(st.nameRe, "i") : null;
      const hit = results.find(r =>
        (sellerRe.test(r.sellerName || "") || sellerRe.test(r.artistName || "")) &&
        (!nameRe || nameRe.test(r.trackName || "")));
      if (hit) {
        st.appleId = String(hit.trackId);
        changed = true;
        report.warnings.push(`discoverApple(${appKey}): 锁定 ${hit.trackName} / ${hit.sellerName || hit.artistName} / id${hit.trackId}`);
      } else {
        report.warnings.push(`discoverApple(${appKey}): 未找到开发商匹配（候选：${results.slice(0,3).map(r=>r.trackName+"/"+(r.sellerName||r.artistName)).join("; ")}）`);
      }
    } catch (e) { report.warnings.push(`discoverApple(${appKey}): ${e.message}`); }
  }
  // Play：逐个候选包名验证（美区页 200 且含内购字段/开发商匹配）
  async function discoverPlay(appKey) {
    const st = prices.products[appKey].store || {};
    if (st.playPkg || !(st.playCandidates || []).length) return;
    const devRe = new RegExp(st.devRe || ".", "i");
    for (const pkg of st.playCandidates) {
      try {
        const { status, text } = await get(`https://play.google.com/store/apps/details?id=${pkg}&hl=en&gl=US`);
        if (status === 200 && devRe.test(text)) {
          st.playPkg = pkg;
          changed = true;
          report.warnings.push(`discoverPlay(${appKey}): 锁定 ${pkg}`);
          return;
        }
      } catch {}
      await sleep(300);
    }
    report.warnings.push(`discoverPlay(${appKey}): 候选包名均未命中`);
  }
  if (!PLAY_ONLY) for (const k of PRODUCT_KEYS) { await discoverApple(k); await sleep(300); }
  for (const k of PRODUCT_KEYS) await discoverPlay(k);

  // 汇率（本币 → 美元折算）
  let fx = null;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const j = await res.json();
    if (j && j.rates) fx = j.rates;
  } catch (e) { report.warnings.push("汇率获取失败: " + e.message); }
  const toUSD = (num, cc) => {
    if (CC_CURRENCY[cc] === "USD") return num;
    const cur = CC_CURRENCY[cc];
    return fx && fx[cur] ? +(num / fx[cur]).toFixed(2) : null;
  };

  const classify = (appKey, name) => {
    if (ANNUAL_RE.test(name)) return null;
    for (const [re, tier] of rulesOf(appKey)) if (re.test(name)) return tier;
    return null;
  };

  // 1. Apple：全产品 × 18 区（--play-only 时跳过；Apple 需海外节点）
  if (!PLAY_ONLY) {
    for (const appKey of PRODUCT_KEYS) {
      const appleId = prices.products[appKey].store?.appleId;
      if (!appleId) { report.apple[appKey] = { skipped: "无 appleId（待发现）" }; continue; }
      // SKU 预过滤 = 该产品档位规则 ∪ 通用订阅词（避免窄过滤漏掉 c.ai+ / 中文会员名等）
      const keepRe = new RegExp(
        (prices.products[appKey].tierRules || []).map(x => x[0]).concat(
          ["pro","max","plus","super","premium","go","month","membership","会员","年","月"]).join("|"), "i");
      report.apple[appKey] = {};
      let filled = 0;
      for (const cc of STOREFRONTS) {
        let r;
        try { r = await fetchAppleIAP(appleId, cc, keepRe); }
        catch (e) { r = { ok: false, reason: e.message }; }
        report.apple[appKey][cc] = r;
        if (r.ok) {
          const baseTier = prices.products[appKey].baseTier;
          const seen = new Set();   // 同档多 SKU 只取本次抓取的第一个；跨天价格变动可覆盖旧值
          for (const iap of r.iaps || []) {
            const tier = classify(appKey, iap.name);
            if (!tier || seen.has(tier)) continue;
            const num = parseMoney(iap.price);
            if (!num) continue;
            seen.add(tier);
            const region = regionOf(appKey, cc);
            const usd = toUSD(num, cc);
            if (usd != null) {
              if (region[tier] !== usd) { region[tier] = usd; changed = true; }
              filled++;
            }
            if (tier === baseTier) {
              const local = String(iap.price).trim();
              if (region.local !== local) { region.local = local; region.localAmount = num; changed = true; }
            }
          }
        }
        await sleep(500);
      }
      if (filled > 0) setProv(`appstore-${appKey}`, "apps.apple.com 各区商店页（管线直抓）+ 公开汇率折算");
    }
  }

  // 2. Google Play：全产品 × 18 区
  for (const appKey of PRODUCT_KEYS) {
    const playPkg = prices.products[appKey].store?.playPkg;
    if (!playPkg) { report.play[appKey] = { skipped: "无 playPkg（待发现）" }; continue; }
    report.play[appKey] = {};
    let filled = 0;
    for (const gl of STOREFRONTS) {
      let r;
      try { r = await fetchPlayRange(playPkg, gl); }
      catch (e) { r = { ok: false, reason: e.message }; }
      report.play[appKey][gl] = r;
      if (r.ok) {
        const region = regionOf(appKey, gl);
        if (region.play !== r.range) { region.play = r.range; changed = true; }
        filled++;
      }
      await sleep(400);
    }
    if (filled > 0) setProv(`play-${appKey}`, `play.google.com 各区商店页（管线直抓，${filled}/18 区）`);
  }

  // 3. IMF PPPEX + 各产品 PPP 负担
  if (!PLAY_ONLY) {
    try {
      const ppp = await fetchIMFPPP();
      report.imfPPP = ppp.ok ? { ok: true, year: ppp.year } : ppp;
      if (ppp.ok) {
        for (const meta of prices.regionsMeta) {
          if (ppp.rates[meta.cc] != null) { meta.pppex = +(+ppp.rates[meta.cc]).toFixed(3); changed = true; }
        }
        setProv("imf-ppp", `IMF DataMapper API（PPPEX，${ppp.year} 年值）`);
      }
    } catch (e) { report.imfPPP = { ok: false, reason: e.message }; }
  }
  // PPP 负担 = 本币金额 / PPPEX；美元挂牌区先按市场汇率折成本币
  for (const appKey of PRODUCT_KEYS) {
    for (const meta of prices.regionsMeta) {
      const region = prices.products[appKey].regions[meta.cc];
      if (!region || region.localAmount == null || meta.pppex == null) continue;
      let lcu = region.localAmount;
      const cur = PPP_LOCAL_CUR[meta.cc];
      if (cur) {
        if (!fx || !fx[cur]) continue;
        lcu = region.localAmount * fx[cur];
      }
      const v = +(lcu / meta.pppex).toFixed(2);
      if (region.ppp !== v) { region.ppp = v; changed = true; }
    }
  }

  // 4. 定价页变更检测
  let watchChanged = false;
  for (const page of PLAY_ONLY ? [] : WATCH_PAGES) {
    try {
      const { status, text } = await get(page.url);
      if (status !== 200) { report.watch[page.key] = { ok: false, reason: `HTTP ${status}` }; continue; }
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

  // 5. 落盘
  if (!DRY) {
    if (changed) {
      prices.updatedAt = today();
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
