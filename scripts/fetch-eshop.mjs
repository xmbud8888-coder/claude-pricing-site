#!/usr/bin/env node
/**
 * 任天堂 eShop 各国价格抓取管线 → data/eshop.json
 *
 * 与 fetch-prices.mjs 同一套约定：零依赖（Node ≥18 自带 fetch）、诚实 null
 * （拿不到的 国家×游戏 一律 null，站上显示"待核验"，绝不猜数）、名称正则
 * 防伪校验（NSUID 发现结果名称不匹配即丢弃并记 warning，宁缺毋滥）、
 * open.er-api.com 公开汇率折算 USD。
 *
 * 数据路线（2026-07 实测均可从中国大陆网络直连；如被墙可用 Node ≥24 的
 * NODE_USE_ENV_PROXY=1 https_proxy=http://127.0.0.1:1082 走代理重试）：
 *  1. NSUID 发现（按区）：
 *     - 美区：Nintendo 官网公开 Algolia 索引 store_game_en_us
 *       （appId U3B6GR4UA3 + 官网前端内嵌的 search-only key，均为公开值）
 *     - 欧区：searching.nintendo-europe.com 公开 Solr 接口（fq=type:GAME，取 nsuid_txt）
 *     - 日区：search.nintendo.jp/nintendo_soft/search.json（items[].id 即 NSUID）
 *     - 港区/韩区：无公开可核验的发现源 → 全部 null。
 *       （nintendo.com.hk 的 switch_software.json 数据止于 2022-06；
 *        store.nintendo.com.hk / store.nintendo.co.kr 均为 202 排队页+纯 JS 壳，
 *        无法零依赖核验名称；ec.nintendo.com/api/{CC}/... 旧接口已下线）
 *  2. 价格：api.ec.nintendo.com/v1/price?country={CC}&lang=en&ids=…（官方接口，
 *     每国一次批量请求）。NSUID 按区分组：美区 NSUID 适用 US/CA/MX/BR/AR/CL/CO/PE，
 *     欧区适用 GB/DE/FR/ES/IT/NL/PL/NO/CH/ZA/AU/NZ，日区适用 JP
 *     （实测 JP NSUID 在 HK/KR 均 not_found，两地 NSUID 独立）。
 *  3. 主字段取 regular_price（常规价）；折扣期另记 discountPrice/discountUsd。
 *
 * 特例：nintendo-switch-online 为订阅制会员，三区目录接口均无 GAME 类条目，
 * 会员 NSUID 无公开可核验的发现源（硬编码猜测违反防伪规则）→ 整行 null。
 * final-fantasy-vii-rebirth 按正常流程发现，哪个区搜不到即该区 null。
 *
 * 用法：node scripts/fetch-eshop.mjs [--dry-run]
 * 合格线：≥12/16 游戏拿到 ≥10 国核验价，否则 exit 2（CI 报警）。
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

/* ---------- 国家分组（价格接口按 NSUID 区域分组请求） ---------- */
const REGION_GROUPS = {
  us: ["US", "CA", "MX", "BR", "AR", "CL", "CO", "PE"],
  eu: ["GB", "DE", "FR", "ES", "IT", "NL", "PL", "NO", "CH", "ZA", "AU", "NZ"],
  jp: ["JP"],
  hk: ["HK"],
  kr: ["KR"],
};
const ALL_COUNTRIES = Object.values(REGION_GROUPS).flat();

/* ---------- 游戏清单（slug 固定，来自站点）----------
 * us/eu/jp: { q: 搜索词, re: 名称防伪正则（对归一化后标题做锚定匹配） }
 * 正则必须锚定全名，避免把 Switch 2 Edition / 扩展票 / 同捆包错认成本体 */
const GAMES = [
  {
    slug: "animal-crossing-new-horizons",
    label: "Animal Crossing: New Horizons",
    us: { q: "Animal Crossing New Horizons", re: /^Animal Crossing: New Horizons$/i },
    eu: { q: "Animal Crossing New Horizons", re: /^Animal Crossing: New Horizons$/i },
    jp: { q: "あつまれ どうぶつの森", re: /^あつまれ どうぶつの森$/ },
  },
  {
    slug: "final-fantasy-vii-rebirth",
    label: "Final Fantasy VII Rebirth",
    us: { q: "Final Fantasy VII Rebirth", re: /^Final Fantasy VII Rebirth$/i },
    eu: { q: "Final Fantasy VII Rebirth", re: /^Final Fantasy VII Rebirth$/i },
    jp: { q: "FINAL FANTASY VII REBIRTH", re: /^Final Fantasy VII Rebirth$/i },
  },
  {
    slug: "kirby-and-the-forgotten-land",
    label: "Kirby and the Forgotten Land",
    us: { q: "Kirby and the Forgotten Land", re: /^Kirby and the Forgotten Land$/i },
    eu: { q: "Kirby and the Forgotten Land", re: /^Kirby and the Forgotten Land$/i },
    jp: { q: "星のカービィ ディスカバリー", re: /^星のカービィ ディスカバリー$/ },
  },
  {
    slug: "mario-kart-8-deluxe",
    label: "Mario Kart 8 Deluxe",
    us: { q: "Mario Kart 8 Deluxe", re: /^Mario Kart 8 Deluxe$/i },
    eu: { q: "Mario Kart 8 Deluxe", re: /^Mario Kart 8 Deluxe$/i },
    jp: { q: "マリオカート8 デラックス", re: /^マリオカート ?8 デラックス$/ },
  },
  {
    slug: "monster-hunter-rise",
    label: "Monster Hunter Rise",
    us: { q: "Monster Hunter Rise", re: /^Monster Hunter Rise$/i },
    eu: { q: "Monster Hunter Rise", re: /^Monster Hunter Rise$/i },
    jp: { q: "モンスターハンターライズ", re: /^モンスターハンターライズ$/ },
  },
  {
    // 订阅制会员：三区目录均无 GAME 类条目，会员 NSUID 无公开可核验来源 → 诚实 null
    slug: "nintendo-switch-online",
    label: "Nintendo Switch Online",
    subscription: true,
    note: "订阅制会员，无 GAME 类目录条目可发现 NSUID，价格接口无法核验 → 全部 null（待核验）",
  },
  {
    slug: "pokemon-legends-z-a",
    label: "Pokémon Legends: Z-A",
    us: { q: "Pokemon Legends Z-A", re: /^Pok[eé]mon Legends:? Z-?A$/i },
    eu: { q: "Pokemon Legends Z-A", re: /^Pok[eé]mon Legends:? Z-?A$/i },
    jp: { q: "Pokémon LEGENDS Z-A", re: /^Pok[eé]mon Legends:? Z-?A$/i },
  },
  {
    slug: "pokemon-scarlet",
    label: "Pokémon Scarlet",
    us: { q: "Pokemon Scarlet", re: /^Pok[eé]mon Scarlet$/i },
    eu: { q: "Pokemon Scarlet", re: /^Pok[eé]mon Scarlet$/i },
    jp: { q: "ポケットモンスター スカーレット", re: /^ポケットモンスター スカーレット$/ },
  },
  {
    slug: "pokemon-violet",
    label: "Pokémon Violet",
    us: { q: "Pokemon Violet", re: /^Pok[eé]mon Violet$/i },
    eu: { q: "Pokemon Violet", re: /^Pok[eé]mon Violet$/i },
    jp: { q: "ポケットモンスター バイオレット", re: /^ポケットモンスター バイオレット$/ },
  },
  {
    slug: "splatoon-3",
    label: "Splatoon 3",
    us: { q: "Splatoon 3", re: /^Splatoon 3$/i },
    eu: { q: "Splatoon 3", re: /^Splatoon 3$/i },
    jp: { q: "スプラトゥーン3", re: /^スプラトゥーン3$/ },
  },
  {
    slug: "super-mario-galaxy-plus-super-mario-galaxy-2",
    label: "Super Mario Galaxy + Super Mario Galaxy 2",
    us: { q: "Super Mario Galaxy + Super Mario Galaxy 2", re: /^Super Mario Galaxy ?\+ ?Super Mario Galaxy ?2$/i },
    eu: { q: "Super Mario Galaxy + Super Mario Galaxy 2", re: /^Super Mario Galaxy ?\+ ?Super Mario Galaxy ?2$/i },
    jp: { q: "スーパーマリオギャラクシー", re: /^スーパーマリオギャラクシー ?\+ ?スーパーマリオギャラクシー ?2$/ },
  },
  {
    slug: "super-mario-odyssey",
    label: "Super Mario Odyssey",
    us: { q: "Super Mario Odyssey", re: /^Super Mario Odyssey$/i },
    eu: { q: "Super Mario Odyssey", re: /^Super Mario Odyssey$/i },
    jp: { q: "スーパーマリオ オデッセイ", re: /^スーパーマリオ ?オデッセイ$/ },
  },
  {
    slug: "super-mario-party-jamboree",
    label: "Super Mario Party Jamboree",
    us: { q: "Super Mario Party Jamboree", re: /^Super Mario Party Jamboree$/i },
    eu: { q: "Super Mario Party Jamboree", re: /^Super Mario Party Jamboree$/i },
    jp: { q: "スーパー マリオパーティ ジャンボリー", re: /^スーパー ?マリオパーティ ?ジャンボリー$/ },
  },
  {
    slug: "super-smash-bros-ultimate",
    label: "Super Smash Bros. Ultimate",
    us: { q: "Super Smash Bros Ultimate", re: /^Super Smash Bros\.? Ultimate$/i },
    eu: { q: "Super Smash Bros Ultimate", re: /^Super Smash Bros\.? Ultimate$/i },
    jp: { q: "大乱闘スマッシュブラザーズ SPECIAL", re: /^大乱闘スマッシュブラザーズ SPECIAL$/i },
  },
  {
    slug: "xenoblade-chronicles-3",
    label: "Xenoblade Chronicles 3",
    us: { q: "Xenoblade Chronicles 3", re: /^Xenoblade Chronicles ?3$/i },
    eu: { q: "Xenoblade Chronicles 3", re: /^Xenoblade Chronicles ?3$/i },
    jp: { q: "ゼノブレイド3", re: /^(Xenoblade ?3|ゼノブレイド3)( ?\(ゼノブレイド3\))?$/i },
  },
  {
    slug: "zelda-tears-of-the-kingdom",
    label: "The Legend of Zelda: Tears of the Kingdom",
    us: { q: "Zelda Tears of the Kingdom", re: /^The Legend of Zelda: Tears of the Kingdom$/i },
    eu: { q: "Zelda Tears of the Kingdom", re: /^The Legend of Zelda: Tears of the Kingdom$/i },
    jp: { q: "ゼルダの伝説 ティアーズ オブ ザ キングダム", re: /^ゼルダの伝説 ティアーズ ?オブ ?ザ ?キングダム$/ },
  },
];

const warnings = [];
const warn = (m) => { warnings.push(m); console.error("⚠ " + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

/* ---------- HTTP：15s 超时 + 2 次重试 + 请求间隔 ≥150ms（别打爆接口） ---------- */
let lastReq = 0;
async function get(url, { retries = 2, init = {} } = {}) {
  for (let i = 0; ; i++) {
    const wait = lastReq + 150 - Date.now();
    if (wait > 0) await sleep(wait);
    lastReq = Date.now();
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "application/json", ...(init.headers || {}) },
        method: init.method || "GET",
        body: init.body,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const text = await res.text();
      if (res.status >= 500 && i < retries) { await sleep(600 * (i + 1)); continue; }
      return { status: res.status, text };
    } catch (e) {
      if (i >= retries) return { status: 0, text: "", error: e.message };
      await sleep(600 * (i + 1));
    }
  }
}
const getJSON = async (url, opts) => {
  const r = await get(url, opts);
  if (r.status !== 200) return { ok: false, reason: r.error ? `网络错误 ${r.error}` : `HTTP ${r.status}` };
  try { return { ok: true, data: JSON.parse(r.text) }; }
  catch (e) { return { ok: false, reason: "JSON 解析失败: " + e.message }; }
};

/* ---------- 标题归一化（供防伪正则匹配）：去 ™®©、全角→半角、空白折叠 ---------- */
function normTitle(s) {
  return String(s)
    .replace(/[™®©]/g, "")
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全角英数符号
    .replace(/[　 ]/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
// NSUID 类别：7001=游戏本体；7007=DLC/同捆包（如 Galaxy 1+2 数字合集）。
// 身份判据是名称锚定正则；类别仅作次级防护：优先本体 7001，无则接受 7007。
const isGameNsuid = (id) => /^7001\d{10}$/.test(String(id));
const isBundleNsuid = (id) => /^7007\d{10}$/.test(String(id));
const pickNsuid = (ids) => ids.find(isGameNsuid) || ids.find(isBundleNsuid) || null;

/* ---------- NSUID 发现（每个结果都过名称防伪正则，不匹配→丢弃） ---------- */

// 美区：Nintendo 官网公开 Algolia 索引（appId 与 search-only key 内嵌于官网前端，公开值）
async function discoverUS(game) {
  const r = await getJSON("https://U3B6GR4UA3-dsn.algolia.net/1/indexes/store_game_en_us/query", {
    init: {
      method: "POST",
      headers: {
        "X-Algolia-Application-Id": "U3B6GR4UA3",
        "X-Algolia-API-Key": "a29c6927638bfd8cee23993e51e721c9",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: game.us.q, hitsPerPage: 12, attributesToRetrieve: ["title", "nsuid", "platform"] }),
    },
  });
  if (!r.ok) return { reason: `Algolia: ${r.reason}` };
  const hits = r.data.hits || [];
  const matched = hits.filter((h) => h.nsuid && game.us.re.test(normTitle(h.title)));
  const nsuid = pickNsuid(matched.map((h) => String(h.nsuid)));
  if (nsuid) return { nsuid };
  return { reason: `名称校验无命中（候选：${hits.slice(0, 4).map((h) => normTitle(h.title || "")).join(" | ") || "无结果"}）` };
}

// 欧区：公开 Solr（fq=type:GAME），nsuid_txt 数组里取 7001 开头的本体 NSUID
async function discoverEU(game) {
  const url = `https://searching.nintendo-europe.com/en/select?q=${encodeURIComponent(game.eu.q)}&fq=${encodeURIComponent("type:GAME")}&rows=12&wt=json&fl=title,nsuid_txt`;
  const r = await getJSON(url);
  if (!r.ok) return { reason: `EU Solr: ${r.reason}` };
  const docs = r.data.response?.docs || [];
  for (const d of docs) {
    if (!game.eu.re.test(normTitle(d.title || ""))) continue;
    const nsuid = pickNsuid((d.nsuid_txt || []).map(String));
    if (nsuid) return { nsuid };
  }
  return { reason: `名称校验无命中（候选：${docs.slice(0, 4).map((d) => normTitle(d.title || "")).join(" | ") || "无结果"}）` };
}

// 日区：search.nintendo.jp 公开搜索，items[].id 即 NSUID
async function discoverJP(game) {
  const url = `https://search.nintendo.jp/nintendo_soft/search.json?q=${encodeURIComponent(game.jp.q)}&limit=12`;
  const r = await getJSON(url);
  if (!r.ok) return { reason: `JP search: ${r.reason}` };
  const items = r.data.result?.items || [];
  const matched = items.filter((it) => game.jp.re.test(normTitle(it.title || "")));
  const nsuid = pickNsuid(matched.map((it) => String(it.id)));
  if (nsuid) return { nsuid };
  return { reason: `名称校验无命中（候选：${items.slice(0, 4).map((it) => normTitle(it.title || "")).join(" | ") || "无结果"}）` };
}

/* ---------- 价格：官方接口按国批量查询 ---------- */
async function fetchPrices(country, nsuids) {
  const url = `https://api.ec.nintendo.com/v1/price?country=${country}&lang=en&ids=${nsuids.join(",")}`;
  const r = await getJSON(url);
  if (!r.ok) return { ok: false, reason: r.reason };
  const map = {};
  for (const p of r.data.prices || []) map[String(p.title_id)] = p;
  return { ok: true, map };
}

/* ---------- 主流程 ---------- */
async function main() {
  // 1. NSUID 发现（美/欧/日；港/韩无公开可核验来源，见文件头注释）
  for (const g of GAMES) {
    g.nsuid = { us: null, eu: null, jp: null, hk: null, kr: null };
    if (g.subscription) { warn(`${g.slug}: ${g.note}`); continue; }
    for (const [region, fn] of [["us", discoverUS], ["eu", discoverEU], ["jp", discoverJP]]) {
      try {
        const r = await fn(g);
        if (r.nsuid) g.nsuid[region] = r.nsuid;
        else warn(`discover ${g.slug} [${region}]: ${r.reason}`);
      } catch (e) { warn(`discover ${g.slug} [${region}]: ${e.message}`); }
    }
  }

  // 2. 汇率（与 fetch-prices.mjs 同源；失败则 usd 全为 null，不猜数）
  let fx = null;
  {
    const r = await getJSON("https://open.er-api.com/v6/latest/USD");
    if (r.ok && r.data.rates) fx = r.data.rates;
    else warn("汇率获取失败（usd 字段将为 null）: " + (r.reason || "无 rates"));
  }
  const toUSD = (num, cur) => {
    if (cur === "USD") return +num.toFixed(2);
    return fx && fx[cur] ? +(num / fx[cur]).toFixed(2) : null;
  };

  // 3. 价格：每个 国家×区域组 一次批量请求
  const priceByCountry = {}; // country -> nsuid -> price item
  for (const [region, countries] of Object.entries(REGION_GROUPS)) {
    const nsuids = [...new Set(GAMES.map((g) => g.nsuid[region]).filter(Boolean))];
    if (!nsuids.length) continue;
    for (const cc of countries) {
      const r = await fetchPrices(cc, nsuids);
      if (!r.ok) { warn(`price ${cc}: ${r.reason}`); continue; }
      priceByCountry[cc] = r.map;
    }
  }

  // 4. 组装输出（拿不到 = null；折扣期主字段仍取常规价，另记 discount）
  const games = {};
  const stats = [];
  for (const g of GAMES) {
    const regions = {};
    let filled = 0;
    for (const [region, countries] of Object.entries(REGION_GROUPS)) {
      for (const cc of countries) {
        const nsuid = g.nsuid[region];
        if (!nsuid) { regions[cc.toLowerCase()] = null; continue; }
        const item = priceByCountry[cc]?.[nsuid];
        const raw = item?.regular_price?.raw_value;
        if (raw == null) {
          regions[cc.toLowerCase()] = null;
          if (item && item.sales_status !== "onsale")
            warn(`${g.slug} × ${cc}: sales_status=${item.sales_status}，无常规价 → null`);
          continue;
        }
        const price = +raw;
        const cur = item.regular_price.currency;
        const entry = { cur, price, usd: toUSD(price, cur) };
        if (item.discount_price?.raw_value != null) {
          entry.discountPrice = +item.discount_price.raw_value;
          entry.discountUsd = toUSD(entry.discountPrice, cur);
        }
        regions[cc.toLowerCase()] = entry;
        filled++;
      }
    }
    const out = { label: g.label, nsuid: g.nsuid, regions };
    if (g.note) out.note = g.note;
    games[g.slug] = out;
    stats.push({ slug: g.slug, countries: filled });
  }

  const output = {
    updatedAt: today(),
    policy: "所有数字必须核验自任天堂官方价格接口才展示；拿不到的 国家×游戏 为 null（站上显示待核验），绝不估算",
    source: {
      prices: "api.ec.nintendo.com/v1/price（任天堂官方 eShop 价格接口，逐国批量直抓，主字段为 regular_price 常规价）",
      nsuidDiscovery: {
        us: "Nintendo 官网公开 Algolia 索引 store_game_en_us（名称正则防伪校验）",
        eu: "searching.nintendo-europe.com 公开 Solr（fq=type:GAME，名称正则防伪校验）",
        jp: "search.nintendo.jp/nintendo_soft/search.json（名称正则防伪校验）",
        hk: "暂无公开可核验来源（官方列表 JSON 止于 2022-06，新商店为排队页+JS 壳）→ null",
        kr: "暂无公开可核验来源 → null",
      },
      fx: "open.er-api.com 公开汇率（USD 基准）",
    },
    countries: ALL_COUNTRIES,
    games,
    warnings,
  };

  if (!DRY) {
    await mkdir(path.join(ROOT, "data"), { recursive: true });
    await writeFile(path.join(ROOT, "data", "eshop.json"), JSON.stringify(output, null, 2) + "\n");
  }

  // 5. 汇总 + 合格线（≥12/16 游戏拿到 ≥10 国）
  console.log("\n=== 每款游戏拿到的国家数（/" + ALL_COUNTRIES.length + "） ===");
  for (const s of stats) console.log(String(s.countries).padStart(3) + "  " + s.slug);
  const pass = stats.filter((s) => s.countries >= 10).length;
  console.log(`\n≥10 国核验价的游戏：${pass}/${GAMES.length}（合格线 12）`);
  if (!DRY) console.log("已写入 data/eshop.json");
  if (pass < 12) {
    console.error("\n⚠️ 未达合格线，请检查 warnings");
    process.exit(2);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
