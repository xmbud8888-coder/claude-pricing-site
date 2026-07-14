#!/usr/bin/env node
/**
 * Steam 各国价格抓取器（官方公开接口，零依赖，Node ≥18）
 *
 * 数据信任规则（与 fetch-prices.mjs 一致）：
 *  - appid 通过 storesearch 发现 + 名称正则防伪校验，校验不过宁缺毋滥；
 *  - 价格来自 store.steampowered.com/api/appdetails 官方接口；
 *  - 拿不到的 (游戏×区) 一律 null（站上显示"待核验"），绝不猜数、绝不抄第三方；
 *  - 价格指纹变化 → exit 2（CI 据此开 issue 提醒复核）。
 *
 * 限流友好：appdetails 带 filters=price_overview 支持一次传全部 appids，
 * 因此请求数 = 地区数（而非 游戏×地区）。
 *
 * 用法：node scripts/fetch-steam.mjs           # 全量抓取并写 data/steam.json
 *       node scripts/fetch-steam.mjs --dry     # 只打印不落盘
 * 中国网络下本地调试：https_proxy=http://127.0.0.1:1082 node scripts/fetch-steam.mjs
 */
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "steam.json");
const DRY = process.argv.includes("--dry");

/* ---------------- 游戏清单（slug 与站内页面一一对应） ---------------- */
// nameRe：防伪校验；发现结果名称不匹配即拒绝。appid 首次发现后固化，之后每轮复核名称。
const GAMES = {
  "baldurs-gate-3":                { label: "博德之门 3",            search: "Baldur's Gate 3",              nameRe: /baldur.?s gate 3/i },
  "cyberpunk-2077":                { label: "赛博朋克 2077",          search: "Cyberpunk 2077",               nameRe: /^cyberpunk 2077$/i },
  "dead-by-daylight":              { label: "黎明杀机",              search: "Dead by Daylight",             nameRe: /^dead by daylight$/i },
  "death-stranding-2-on-the-beach":{ label: "死亡搁浅 2",            search: "Death Stranding 2",            nameRe: /death stranding 2/i },
  "elden-ring":                    { label: "艾尔登法环",            search: "Elden Ring",                   nameRe: /^elden ring$/i },
  "forza-horizon-6":               { label: "极限竞速：地平线 6",     search: "Forza Horizon 6",              nameRe: /forza horizon 6/i },
  "god-of-war-ragnarok":           { label: "战神：诸神黄昏",         search: "God of War Ragnarok",          nameRe: /god of war ragnar/i },
  "hollow-knight-silksong":        { label: "空洞骑士：丝之歌",       search: "Hollow Knight Silksong",       nameRe: /silksong/i },
  "meccha-chameleon":              { label: "Meccha Chameleon",      search: "Meccha Chameleon",             nameRe: /meccha chameleon/i },
  "mount-and-blade-ii-bannerlord": { label: "骑马与砍杀 2：霸主",     search: "Mount & Blade II Bannerlord",  nameRe: /bannerlord/i },
  "palworld":                      { label: "幻兽帕鲁",              search: "Palworld",                     nameRe: /^palworld$/i },
  "red-dead-redemption-2":         { label: "荒野大镖客：救赎 2",     search: "Red Dead Redemption 2",        nameRe: /^red dead redemption 2$/i },
  "resident-evil-requiem":         { label: "生化危机：安魂曲",       search: "Resident Evil Requiem",        nameRe: /resident evil.*requiem/i },
  "rust":                          { label: "Rust",                  search: "Rust",                         nameRe: /^rust$/i },
  "sekiro-shadows-die-twice":      { label: "只狼：影逝二度",         search: "Sekiro",                       nameRe: /^sekiro/i },
  "stardew-valley":                { label: "星露谷物语",            search: "Stardew Valley",               nameRe: /^stardew valley$/i },
  "subnautica-2":                  { label: "深海迷航 2",            search: "Subnautica 2",                 nameRe: /^subnautica 2$/i },
  "terraria":                      { label: "泰拉瑞亚",              search: "Terraria",                     nameRe: /^terraria$/i },
};

/* ------------- 地区集合（Steam cc；欧元区取 de 一档代表） ------------- */
// 注：2023 年后 Steam 阿根廷/土耳其改为美元计价（LATAM-USD / MENA-USD 分区）。
const REGIONS = ["us","ar","tr","ru","cn","in","br","ph","vn","id","mx","ca","jp","kr","de","fr","gb","pl","au","no","ch","eg","ng"];

const UA = { headers: { "User-Agent": "Mozilla/5.0 (compatible; ai-pricing-bot/1.0)" } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...UA, signal: AbortSignal.timeout(15000) });
      if (res.status === 429) { await sleep(3000 * (i + 1)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text) throw new Error("empty body");
      return JSON.parse(text);
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1200 * (i + 1));
    }
  }
}

/* ---------------- ① appid 发现 + 防伪校验 ---------------- */
async function discover(prev) {
  const ids = {};
  for (const [slug, g] of Object.entries(GAMES)) {
    const cached = prev?.games?.[slug]?.appid;
    if (cached) { ids[slug] = cached; continue; }   // 已固化，名称在抓价阶段复核
    try {
      const d = await getJSON(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(g.search)}&cc=us&l=en`);
      const hit = (d.items || []).find(it => g.nameRe.test(it.name.trim()));
      if (hit) { ids[slug] = hit.id; console.log(`发现 ${slug} → ${hit.id} (${hit.name})`); }
      else console.warn(`⚠ ${slug} 搜索无名称匹配（宁缺毋滥，跳过）`);
    } catch (e) { console.warn(`⚠ ${slug} 发现失败: ${e.message}`); }
    await sleep(300);
  }
  return ids;
}

/* ---------------- ② 分区批量抓价 ---------------- */
async function fetchRegion(cc, appids) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appids.join(",")}&cc=${cc}&filters=price_overview`;
  const d = await getJSON(url);
  const out = {};
  for (const [appid, entry] of Object.entries(d || {})) {
    if (!entry?.success) { out[appid] = null; continue; }
    const po = entry.data?.price_overview;
    if (!po || typeof po.final !== "number") { out[appid] = null; continue; }   // 免费/未发售/该区不售
    out[appid] = {
      cur: po.currency,
      price: po.initial / 100,                                   // 常规价（主字段，避免折扣期误导）
      discountPrice: po.discount_percent > 0 ? po.final / 100 : undefined,
      discountPct: po.discount_percent > 0 ? po.discount_percent : undefined,
    };
  }
  return out;
}

/* ---------------- ③ FX → USD（与主管线同源） ---------------- */
async function fetchFX() {
  const d = await getJSON("https://open.er-api.com/v6/latest/USD");
  if (d?.result !== "success" || !d.rates?.JPY) throw new Error("FX 数据异常");
  return d.rates;
}

/* ---------------- ④ 名称复核（防 appid 漂移/下架顶替） ---------------- */
async function verifyNames(ids) {
  const appids = Object.values(ids);
  if (!appids.length) return;
  const d = await getJSON(`https://store.steampowered.com/api/appdetails?appids=${appids.join(",")}&cc=us&filters=basic`).catch(() => null);
  if (!d) { console.warn("⚠ 名称复核接口失败，跳过本轮复核"); return; }
  for (const [slug, appid] of Object.entries(ids)) {
    const name = d[appid]?.data?.name;
    if (name && !GAMES[slug].nameRe.test(name.trim()))
      console.warn(`⚠ ${slug} appid=${appid} 名称漂移为 "${name}"，本轮数据仍写入，请人工复核`);
  }
}

/* ---------------- 主流程 ---------------- */
const prev = await readFile(OUT, "utf-8").then(JSON.parse).catch(() => null);
const ids = await discover(prev);
await verifyNames(ids);
const fx = await fetchFX();

const regionData = {};
for (const cc of REGIONS) {
  try { regionData[cc] = await fetchRegion(cc, Object.values(ids)); }
  catch (e) { console.warn(`⚠ 区 ${cc} 抓取失败: ${e.message}`); regionData[cc] = {}; }
  await sleep(400);
}

const games = {};
for (const [slug, g] of Object.entries(GAMES)) {
  const appid = ids[slug] || null;
  const regions = {};
  let got = 0;
  for (const cc of REGIONS) {
    const p = appid ? regionData[cc]?.[appid] ?? null : null;
    if (p) {
      const rate = fx[p.cur];
      regions[cc] = { ...p, usd: rate ? +(p.price / rate).toFixed(2) : null };
      got++;
    } else regions[cc] = null;   // 诚实待核验
  }
  games[slug] = { label: g.label, appid, regions };
  console.log(`${slug}: ${got}/${REGIONS.length} 区核验`);
}

const out = {
  updatedAt: new Date().toISOString().slice(0, 10),
  source: "Steam 官方 storefront API（appdetails/price_overview），appid 经 storesearch 发现并名称防伪校验；USD 折算 open.er-api.com",
  regions: REGIONS,
  games,
};

// 价格指纹：与上一版比对，有变化 exit 2（CI 开 issue 提醒）
const fp = o => JSON.stringify(Object.fromEntries(Object.entries(o.games).map(([s, g]) => [s, Object.entries(g.regions).map(([c, r]) => `${c}:${r?.price ?? "-"}`).join("|")])));
const changed = prev && fp(prev) !== fp(out);

if (DRY) console.log(JSON.stringify(out, null, 2).slice(0, 2000));
else { await writeFile(OUT, JSON.stringify(out, null, 2)); console.log(`已写入 ${OUT}`); }
if (changed) { console.log("价格指纹变化"); process.exit(2); }
