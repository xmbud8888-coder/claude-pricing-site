#!/usr/bin/env node
/**
 * 全站生成器（模板：templates/product.html）
 *  - AI 产品页 ×21（含 claude.html；index.html 已让位给枢纽首页）
 *  - Steam 游戏页 ×18（steam-{slug}.html）、eShop 游戏页 ×16（eshop-{slug}.html）
 *  - 四张板块索引页：ai.html / streaming.html / steam.html / eshop.html
 * 数据源：data/prices.json、data/steam.json、data/eshop.json（页面不硬编码数字）。
 * 运行：node scripts/build-pages.mjs
 */
import { readFile, writeFile, access } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => readFile(path.join(ROOT, f), "utf-8");
const prices = JSON.parse(await read("data/prices.json"));
const steam = JSON.parse(await read("data/steam.json").catch(() => '{"games":{}}'));
const eshop = JSON.parse(await read("data/eshop.json").catch(() => '{"games":{}}'));
const tpl = await read("templates/product.html");
const META = Object.fromEntries(prices.regionsMeta.map(m => [m.cc, m]));

// 流媒体四杰在"流媒体"索引展示，其余进 AI 索引；详情页共用一套命名空间（对齐目标站架构）
const STREAMING_KEYS = ["netflix", "spotify", "youtube", "hbo-max"];

const fmtUSD = v => "$" + v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });

async function iconFor(key, label) {
  const file = path.join(ROOT, "assets", "icons", `${key}.svg`);
  try {
    await access(file);
    const svg = (await read(`assets/icons/${key}.svg`)).trim();
    return { svg, full: svg.includes('data-full="1"') };
  } catch {
    const letter = label.replace(/[^A-Za-z0-9一-鿿]/g, "").slice(0, 1).toUpperCase() || "A";
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1d1d1f"/><text x="32" y="43" font-family="system-ui,sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text></svg>`,
      full: true,
    };
  }
}

const breadcrumb = items =>
  items.map(it => it.href ? `<a href="${it.href}">${it.label}</a>` : `<span>${it.label}</span>`)
       .join(' <span class="bc-sep">›</span> ');

/* ================= AI / 流媒体产品页 ================= */

async function buildProductPage(key, p) {
  const tierNames = p.tiers.map(t => t.label).join(" / ");
  const isStreaming = STREAMING_KEYS.includes(key);
  const title = `2026 各国 ${p.label} 价格对比 | ${p.label} 哪个国家最便宜`;
  const desc = `比较 ${p.label} 订阅（${tierNames}）在全球 App Store 与 Google Play 各区域的价格：最便宜/最贵国家排行、完整价格表、购买力对比、换区订阅指南。数据每日自动抓取官方商店页核验。`;
  const icon = await iconFor(key, p.label);

  let html = tpl;
  html = html.replace('data-product="claude"', `data-product="${key}"`);
  html = html.replace(/<title>.*?<\/title>/s, `<title>${title}</title>`);
  html = html.replace(/(<meta name="description" content=").*?(">)/s, `$1${desc}$2`);
  html = html.replace(/<div class="app-icon[^"]*">[\s\S]*?<\/div>\n/,
    `<div class="app-icon${icon.full ? " icon-full" : ""}">${icon.svg}</div>\n`);
  html = html.replace(
    /<h1><a href="https:\/\/claude\.ai\/" rel="noopener" target="_blank">Claude 全球定价<\/a><\/h1>/,
    `<h1><a href="${p.site}" rel="noopener" target="_blank">${p.label} 全球定价</a></h1>`);
  html = html.replace('开发者：Anthropic ·', `开发者：${p.developer} ·`);
  for (const [re, to] of [
    [/Claude 全球价格地图/g, `${p.label} 全球价格地图`],
    [/Claude 最便宜的国家/g, `${p.label} 最便宜的国家`],
    [/Claude 最贵的国家/g, `${p.label} 最贵的国家`],
    [/Claude 定价 vs 本地购买力/g, `${p.label} 定价 vs 本地购买力`],
    [/Claude 订阅定价 FAQ/g, `${p.label} 订阅定价 FAQ`],
    [/哪个国家的 Claude 订阅最便宜/g, `哪个国家的 ${p.label} 订阅最便宜`],
    [/为什么 Claude 在英国和欧洲这么贵/g, `为什么 ${p.label} 在英国和欧洲这么贵`],
    [/Claude 在 Google Play、网页版和 App Store 之间有价格差异吗/g, `${p.label} 在 Google Play、网页版和 App Store 之间有价格差异吗`],
    [/下载 Claude，在 App 内购买订阅/g, `下载 ${p.label}，在 App 内购买订阅`],
    [/订阅网页价核验自 claude\.com\/pricing 与官方帮助中心；/g, ""],
    [/订阅网页价来自 claude\.com\/pricing；/g, ""],
    [/Claude 是 Anthropic 的商标。/g, `${p.label} 是 ${p.developer} 的商标。`],
    [/与 Anthropic 无关联/g, `与 ${p.developer} 无关联`],
  ]) html = html.replace(re, to);
  html = html.replace("<!--BREADCRUMB-->", breadcrumb([
    { label: "首页", href: "index.html" },
    isStreaming ? { label: "流媒体定价", href: "streaming.html" } : { label: "AI 区域定价", href: "ai.html" },
    { label: p.label },
  ]));
  await writeFile(path.join(ROOT, `${key}.html`), html);
}

/* ================= Steam / eShop 游戏页 ================= */

const GAME_COPY = {
  steam: {
    indexHref: "steam.html", indexLabel: "Steam 比价", storeName: "Steam",
    tableH2: "Steam 各区价格表",
    site: g => g.appid ? `https://store.steampowered.com/app/${g.appid}/` : "https://store.steampowered.com/",
    devLine: "平台：Steam · 官方 storefront 接口",
    footerSrc: "价格数据来自 Steam 官方 storefront 接口（appdetails，管线每日直抓，appid 经名称防伪校验）；购买力（PPP）数据来自 IMF DataMapper；汇率取自公开市场数据。",
    tm: g => `${g.label} 相关商标归其各自权利人所有。`,
    howtoTitle: "Steam 换区购买说明",
    howtoSub: "Steam 对更改商店地区有严格限制（需在目标地区产生真实支付记录，且每 3 个月最多改一次），跨区礼赠同样受价差限制。以下步骤仅供确需换区的用户参考。",
    faq: g => [
      [`哪个国家的 ${g.label} 最便宜？`, `<p id="faqCheapest">见上方"最便宜的地区"排行，数据每日自动核验更新。</p>`],
      ["Steam 各区价格为什么差这么多？", "<p>Steam 按地区购买力给出推荐定价，开发商可在此基础上自行调价；再叠加汇率波动与各国税制（部分地区结账另加税），就形成了成倍的区间差。</p>"],
      ["直接换区买更便宜的版本可行吗？", "<p>Steam 要求使用目标地区的支付方式，且会检测常用登录地，频繁换区可能触发商店限制；跨区礼赠在价差过大的区域之间会被直接拦截。请把换区视为真实居住变更时的功能，而不是常规省钱手段。</p>"],
      ["为什么有的地区显示\"待核验\"？", "<p>该游戏在该计价区未上架、未公示价格或接口访问受限，管线抓不到官方数字。本站规则是\"核验不到就不显示\"，不会用第三方转述数据填充。</p>"],
      ["本站的数据来自哪里？多久更新？", "<p>价格由自动管线每日调用 Steam 官方 storefront 接口逐区抓取，appid 经名称防伪校验；购买力数据来自 IMF DataMapper（PPPEX）；汇率取公开市场价。来源与核验日期见页尾\"数据来源账本\"。</p>"],
    ],
  },
  eshop: {
    indexHref: "eshop.html", indexLabel: "eShop 比价", storeName: "任天堂 eShop",
    tableH2: "eShop 各区价格表",
    site: () => "https://www.nintendo.com/",
    devLine: "平台：任天堂 eShop · 官方价格接口",
    footerSrc: "价格数据来自任天堂官方价格接口（api.ec.nintendo.com，管线每日直抓，NSUID 经名称防伪校验）；购买力（PPP）数据来自 IMF DataMapper；汇率取自公开市场数据。",
    tm: g => `${g.label} 相关商标归任天堂或其各自权利人所有。`,
    howtoTitle: "eShop 换区购买说明",
    howtoSub: "任天堂账号的国家/地区可以更改（余额为零时），Switch 主机也支持多账号并存——换区门槛比 Steam 低，但请注意余额与会员资格不跨区。",
    faq: g => [
      [`哪个国家的 ${g.label} 最便宜？`, `<p id="faqCheapest">见上方"最便宜的地区"排行，数据每日自动核验更新。</p>`],
      ["eShop 各区价格为什么不同？", "<p>任天堂各区独立定价，叠加汇率与税制差异（美国多数州结账另加售税、欧洲挂牌含 VAT），实际支付价随之拉开，部分地区还有独立的促销节奏。</p>"],
      ["换区买数字版可行吗？", "<p>可行且门槛不高：新建目标地区的任天堂账号，加入 Switch 主机后用该账号购买，游戏对主机上所有账号可用。注意 eShop 余额与礼品卡不跨区，NSO 会员按账号地区计费。</p>"],
      ["为什么有的地区显示\"待核验\"？", "<p>该游戏在该区商店无对应 NSUID、未上架，或该区（如港/韩）没有可核验的官方目录接口。本站规则是\"核验不到就不显示\"，不会用第三方转述数据填充。</p>"],
      ["本站的数据来自哪里？多久更新？", "<p>价格由自动管线每日调用任天堂官方价格接口逐区抓取，NSUID 经美/欧/日三区官方目录发现并名称防伪校验；购买力数据来自 IMF DataMapper（PPPEX）；汇率取公开市场价。来源与核验日期见页尾\"数据来源账本\"。</p>"],
    ],
  },
};

async function buildGamePage(cat, slug, g) {
  const C = GAME_COPY[cat];
  const title = `2026 各国 ${g.label} ${C.storeName}价格对比 | 哪个区最便宜`;
  const desc = `比较 ${g.label} 在${C.storeName}全球各区的售价：最便宜/最贵地区排行、完整价格表、购买力对比。数据每日自动调用官方接口核验。`;
  const icon = await iconFor(`${cat}-${slug}`, g.label);

  let html = tpl;
  html = html.replace('data-product="claude"', `data-catalog="${cat}" data-product="${slug}"`);
  html = html.replace(/<title>.*?<\/title>/s, `<title>${title}</title>`);
  html = html.replace(/(<meta name="description" content=").*?(">)/s, `$1${desc}$2`);
  html = html.replace(/<div class="app-icon[^"]*">[\s\S]*?<\/div>\n/,
    `<div class="app-icon${icon.full ? " icon-full" : ""}">${icon.svg}</div>\n`);
  html = html.replace(
    /<h1><a href="https:\/\/claude\.ai\/" rel="noopener" target="_blank">Claude 全球定价<\/a><\/h1>/,
    `<h1><a href="${C.site(g)}" rel="noopener" target="_blank">${g.label} 全球价格</a></h1>`);
  html = html.replace('开发者：Anthropic ·', `${C.devLine} ·`);

  html = html.replace(/Claude 全球价格地图/g, `${g.label} 全球价格地图`);
  html = html.replace(/Claude 最便宜的国家/g, `${g.label} 最便宜的地区`);
  html = html.replace(/Claude 最贵的国家/g, `${g.label} 最贵的地区`);
  html = html.replace(/Claude 定价 vs 本地购买力/g, `${g.label} 价格 vs 本地购买力`);
  html = html.replace(/App Store 各区价格表<span class="h2-tag">[^<]*<\/span>/,
    `${C.tableH2}<span class="h2-tag">每日核验</span>`);
  html = html.replace(/价格为含税挂牌价折美元[^<]*/,
    "价格为官方接口挂牌价折美元（本币原文见基准档下方）。部分地区结账时另加税费；打折期间按常规价排序，折扣价另行标注。");
  html = html.replace(/<!-- Google Play 各区价格 -->[\s\S]*?<\/section>\n/, "");
  html = html.replace("<h2>换区订阅操作指南</h2>", `<h2>${C.howtoTitle}</h2>`);
  html = html.replace(/<p class="section-sub">适用于确需换区的用户。[^<]*<\/p>/, `<p class="section-sub">${C.howtoSub}</p>`);
  const faqHtml = C.faq(g).map(([q, a], i) => `      <details${i === 0 ? " open" : ""}>
        <summary>${q}</summary>
        ${a}
      </details>`).join("\n");
  html = html.replace(/<h2>Claude 订阅定价 FAQ<\/h2>\n    <div class="faq-list">[\s\S]*?<\/div>\n  <\/div>\n<\/section>/,
    `<h2>${g.label} 价格 FAQ</h2>\n    <div class="faq-list">\n${faqHtml}\n    </div>\n  </div>\n</section>`);
  html = html.replace(/价格数据来自 Apple App Store 与 Google Play 官方商店页[^<]*/,
    C.footerSrc + `最近核验：<span class="data-date">—</span>。`);
  html = html.replace(/本站为独立第三方信息站，与 Anthropic 无关联。Claude 是 Anthropic 的商标。/,
    `本站为独立第三方信息站，与 Valve、任天堂及各游戏厂商均无关联。${C.tm(g)}`);
  html = html.replace("<!--BREADCRUMB-->", breadcrumb([
    { label: "首页", href: "index.html" },
    { label: C.indexLabel, href: C.indexHref },
    { label: g.label },
  ]));
  await writeFile(path.join(ROOT, `${cat}-${slug}.html`), html);
}

/* ================= T1 板块索引页 ================= */

const chrome = (() => {
  const nav = tpl.match(/<nav class="topnav">[\s\S]*?<\/nav>/)[0];
  const footer = tpl.match(/<footer class="footer">[\s\S]*?<\/footer>/)[0]
    .replace(/价格数据来自[^<]*/, "各板块价格数据均由自动管线每日直抓官方接口/官方商店页核验；购买力数据来自 IMF DataMapper；汇率取自公开市场数据。")
    .replace(/本站为独立第三方信息站[^<]*/, "本站为独立第三方信息站，与各产品/平台厂商均无关联，所列商标归各自权利人所有。价格可能变动，下单前请以官方页面为准。");
  return { nav, footer };
})();

const TABS = [
  { key: "ai", href: "ai.html", label: "AI 定价" },
  { key: "streaming", href: "streaming.html", label: "流媒体" },
  { key: "steam", href: "steam.html", label: "Steam" },
  { key: "eshop", href: "eshop.html", label: "eShop" },
];
const tabBar = active => `<div class="vert-tabs" role="tablist">` + TABS.map(t =>
  `<a class="vt-pill${t.key === active ? " active" : ""}" href="${t.href}"${t.key === active ? ' aria-current="page"' : ""}>${t.label}</a>`).join("") + `</div>`;

// 实体 → 索引卡（最便宜前 4 + 断档行 + 最贵，价差徽章；不足则如实展示核验中）
function entityCard({ href, iconHtml, label, sub, rows, unit }) {
  const ok = rows.filter(r => r.usd != null).sort((a, b) => a.usd - b.usd);
  let badge = `<span class="card-more">查看更多 →</span>`, body;
  if (ok.length >= 2) {
    const spread = Math.round((ok[ok.length - 1].usd - ok[0].usd) / ok[0].usd * 100);
    if (spread > 0) badge = `<span class="spread-badge">${spread}% 价差</span>`;
    const top = ok.slice(0, 4);
    const last = ok[ok.length - 1];
    const row = (r, rank) => `<tr>
      <td class="pt-rank">${rank}</td>
      <td><span class="pt-flag">${META[r.cc]?.flag || ""}</span> ${META[r.cc]?.name || r.cc}</td>
      <td class="pt-price"><span class="pc-pill${rank === 1 ? " pc-low" : ""}">${fmtUSD(r.usd)}${unit}</span><span class="pt-local">≈ ${r.local}</span></td>
      <td class="pt-tax">${META[r.cc]?.tax || "—"}</td>
    </tr>`;
    body = `<table class="preview-table"><thead><tr><th>#</th><th>地区</th><th>价格</th><th>税费</th></tr></thead><tbody>` +
      top.map((r, i) => row(r, i + 1)).join("") +
      (ok.length > 5 ? `<tr class="pt-gap"><td colspan="4">···</td></tr>` : "") +
      (ok.length > 4 ? row(last, ok.length) : "") +
      `</tbody></table>`;
  } else {
    body = `<p class="card-pending">各区价格核验中——本站只展示官方接口/官方页面核验过的数字，核验完成自动上线。</p>`;
  }
  return `<a class="entity-card" href="${href}">
    <div class="ec-head">
      <div class="ec-id">${iconHtml}<div><h2>${label} 各地区定价</h2><p class="ec-sub">${sub}</p></div></div>
      ${badge}
    </div>
    ${body}
  </a>`;
}

async function buildIndexPage({ file, active, h1, sub, cards, srcLine }) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#05070e">
<title>${h1} | AI 定价站</title>
<meta name="description" content="${sub}">
<link rel="stylesheet" href="style.css?v=s6">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💰</text></svg>">
</head>
<body class="index-page">
${chrome.nav}
<main>
<section class="index-hero">
  <div class="wrap">
    <h1>${h1}</h1>
    <p class="section-sub">${sub}</p>
    ${tabBar(active)}
  </div>
</section>
<section class="section" style="padding-top:8px">
  <div class="wrap">
    <div class="card-grid">
${cards.join("\n")}
    </div>
    <p class="fine" style="margin-top:18px">${srcLine}</p>
  </div>
</section>
<div class="wrap breadcrumb" aria-label="面包屑">
  ${breadcrumb([{ label: "首页", href: "index.html" }, { label: h1 }])}
</div>
</main>
${chrome.footer}
</body>
</html>
`;
  await writeFile(path.join(ROOT, file), html);
}

/* ================= 执行 ================= */

let n = 0;
for (const [key, p] of Object.entries(prices.products)) { await buildProductPage(key, p); n++; }
for (const [slug, g] of Object.entries(steam.games)) { await buildGamePage("steam", slug, g); n++; }
for (const [slug, g] of Object.entries(eshop.games)) { await buildGamePage("eshop", slug, g); n++; }

const productRows = p => Object.entries(p.regions || {})
  .map(([cc, r]) => ({ cc, usd: r?.[p.baseTier] ?? null, local: r?.local || "—" }))
  .filter(r => META[r.cc]);
const gameRows = g => Object.entries(g.regions || {})
  .map(([cc, r]) => ({ cc, usd: r?.usd ?? null, local: r ? `${r.cur} ${r.price}` : "—" }))
  .filter(r => META[r.cc]);

const aiCards = [], streamCards = [];
for (const [key, p] of Object.entries(prices.products)) {
  const icon = await iconFor(key, p.label);
  const card = entityCard({
    href: `${key}.html`,
    iconHtml: `<div class="app-icon ec-icon${icon.full ? " icon-full" : ""}">${icon.svg}</div>`,
    label: p.label,
    sub: `${p.tiers.find(t => t.key === p.baseTier)?.label || ""} 档 · App Store 官方核验`,
    rows: productRows(p), unit: "/mo",
  });
  (STREAMING_KEYS.includes(key) ? streamCards : aiCards).push(card);
}
const gameTile = (bg, fg, ch) => `<div class="app-icon ec-icon icon-full"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg}"/><text x="32" y="43" font-family="system-ui,sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="${fg}">${ch}</text></svg></div>`;
const steamCards = Object.entries(steam.games).map(([slug, g]) => entityCard({
  href: `steam-${slug}.html`, iconHtml: gameTile("#16202f", "#8ab4ff", g.label.slice(0, 1)),
  label: g.label, sub: "Steam 官方接口 · 每日核验", rows: gameRows(g), unit: "",
}));
const eshopCards = Object.entries(eshop.games).map(([slug, g]) => entityCard({
  href: `eshop-${slug}.html`, iconHtml: gameTile("#2f1616", "#ff8a80", g.label.slice(0, 1)),
  label: g.label, sub: "任天堂官方接口 · 每日核验", rows: gameRows(g), unit: "",
}));

await buildIndexPage({ file: "ai.html", active: "ai",
  h1: "各国最便宜的 AI 订阅价格",
  sub: "比较主流 AI 产品在全球 App Store 各区的订阅价格，找到最划算的订阅地区。全部数字来自官方商店页每日核验。",
  cards: aiCards, srcLine: "数据来源：Apple App Store / Google Play 各区官方商店页，自动管线每日直抓核验；无法核验的组合如实标注待核验。" });
await buildIndexPage({ file: "streaming.html", active: "streaming",
  h1: "各国最便宜的流媒体订阅价格",
  sub: "比较 Netflix、Spotify、YouTube Premium、HBO Max 在全球各区的订阅价格。官方商店可核验的数字每日更新，其余如实标注待核验。",
  cards: streamCards, srcLine: "数据来源：Apple App Store / Google Play 官方商店页（可核验部分）；流媒体官网各国定价页抓取器建设中，未核验数字不展示。" });
await buildIndexPage({ file: "steam.html", active: "steam",
  h1: "各国最便宜的 Steam 游戏价格",
  sub: "比较热门游戏在 Steam 全球各计价区的售价。数据每日调用 Steam 官方接口核验；打折期间按常规价排序，折扣价另行标注。",
  cards: steamCards, srcLine: "数据来源：Steam 官方 storefront 接口（appdetails），appid 经名称防伪校验，自动管线每日直抓。" });
await buildIndexPage({ file: "eshop.html", active: "eshop",
  h1: "各国最便宜的 eShop 游戏价格",
  sub: "比较任天堂第一方与热门游戏在 eShop 各区商店的售价。数据每日调用任天堂官方价格接口核验。",
  cards: eshopCards, srcLine: "数据来源：任天堂官方价格接口（api.ec.nintendo.com），NSUID 经三区官方目录发现并名称防伪校验，自动管线每日直抓。" });
n += 4;

console.log(`built ${n} pages`);
