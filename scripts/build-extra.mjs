#!/usr/bin/env node
/**
 * 二期页面生成器（内容来自 data/content/*.json，文案均为本站自写）
 *  - gift-cards.html（Apple 礼品卡六国对比）
 *  - apple-id-registration.html（换区注册完整指南）
 *  - vpn.html + leaderboard-{best,free,secure,value,streaming}.html（VPN 板块）
 *  - 国家专页 ×9（chatgpt-india 等，数据驱动自 prices.json）
 * 内容 JSON 缺失时生成"核验中"结构页（诚实待核验，不空链接）。
 * 运行：node scripts/build-extra.mjs
 */
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => readFile(path.join(ROOT, f), "utf-8");
const readJSON = f => read(f).then(JSON.parse).catch(() => null);

const prices = JSON.parse(await read("data/prices.json"));
const tpl = await read("templates/product.html");
const META = Object.fromEntries(prices.regionsMeta.map(m => [m.cc, m]));
const nav = tpl.match(/<nav class="topnav">[\s\S]*?<\/nav>/)[0];
const footer = tpl.match(/<footer class="footer">[\s\S]*?<\/footer>/)[0]
  .replace(/价格数据来自[\s\S]*?<\/p>/, "本页事实字段均注明一手来源；无法核验的信息如实标注待核验。</p>")
  .replace(/本站为独立第三方信息站[^<]*/, "本站为独立第三方信息站，与文中提及的任何厂商均无关联，无联盟返佣。所列商标归各自权利人所有。");

const fmtUSD = v => "$" + v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
const bc = items => items.map(it => it.href ? `<a href="${it.href}">${it.label}</a>` : `<span>${it.label}</span>`).join(' <span class="bc-sep">›</span> ');

function shell({ title, desc, body, crumbs }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#05070e">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="stylesheet" href="style.css?v=s6">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💰</text></svg>">
</head>
<body class="index-page">
${nav}
<main>
${body}
<div class="wrap breadcrumb" aria-label="面包屑">
  ${bc(crumbs)}
</div>
</main>
${footer}
</body>
</html>
`;
}

const pendingBlock = what => `<section class="section"><div class="wrap"><div class="panel">
<h3 class="block-h" style="margin-top:0">${what}核验中</h3>
<p class="section-sub" style="margin:0">本站只发布经一手来源核验的内容。${what}正在采集与核验，完成后自动上线——不会用未经核实的数字或转述占位。</p>
</div></div></section>`;

/* ================= 礼品卡（T6） ================= */
async function buildGiftCards() {
  const d = await readJSON("data/content/giftcards.json");
  let body;
  if (!d) body = `<section class="index-hero"><div class="wrap"><h1>Apple 礼品卡各国对比</h1></div></section>` + pendingBlock("礼品卡数据");
  else {
    const cards = d.countries.map(c => `
    <div class="entity-card gc-card">
      <div class="ec-head"><div class="ec-id"><div>
        <h2>${c.flag} ${c.name} Apple 礼品卡</h2>
        <p class="ec-sub">币种：${c.currency}${c.appleOfficialUrl ? ` · <a href="${c.appleOfficialUrl}" target="_blank" rel="noopener">Apple 官方页 ↗</a>` : " · 官方无在线直购"}</p>
      </div></div></div>
      ${c.denominations ? `<p class="gc-denoms">${c.denominations.map(v => `<span class="pc-pill">${v}</span>`).join(" ")}</p>`
        : `<p class="gc-denoms"><span class="vb vb-wait">官方无固定面额</span></p>`}
      <p class="gc-note">${c.notes}</p>
      <p class="fine">⚠ ${c.risk}</p>
    </div>`).join("\n");
    body = `
<section class="index-hero"><div class="wrap">
  <h1>Apple 礼品卡各国对比</h1>
  <p class="section-sub">换区订阅的支付闭环：各国 Apple 礼品卡的官方面额、发行渠道与避坑要点。面额均核验自 Apple 各国官网（${d.updatedAt}）。</p>
</div></section>
<section class="section" style="padding-top:8px"><div class="wrap">
  <div class="card-grid">${cards}</div>
  <p class="fine" style="margin-top:18px">${d.disclaimer}</p>
</div></section>`;
  }
  await writeFile(path.join(ROOT, "gift-cards.html"), shell({
    title: "Apple 礼品卡各国对比 | AI 定价站",
    desc: "土耳其、印度、美国、巴西、日本、印尼六国 Apple 礼品卡官方面额与发行渠道对比，换区订阅支付指南。",
    body, crumbs: [{ label: "首页", href: "index.html" }, { label: "礼品卡对比" }],
  }));
}

/* ================= 换区指南（T8） ================= */
async function buildGuide(articles = []) {
  const d = await readJSON("data/content/guide-apple-id.json");
  let body;
  if (!d) body = `<section class="index-hero"><div class="wrap"><h1>Apple ID 换区注册完整指南</h1></div></section>` + pendingBlock("指南内容");
  else {
    const methods = d.methods.map(m => `
    <div class="panel" style="margin-bottom:18px">
      <h2 class="panel-h">${m.title}</h2>
      <div class="howto-grid" style="margin-top:16px">
        ${m.steps.map((s, i) => `<div class="step-card"><div class="step-num">${i + 1}</div><h3>${s.title}</h3><p>${s.detail}</p>${s.tip ? `<p class="fine">💡 ${s.tip}</p>` : ""}</div>`).join("")}
      </div>
      ${m.warnings ? `<div class="callout" style="margin-top:14px">${m.warnings.map(w => `⚠ ${w}`).join("<br>")}</div>` : ""}
    </div>`).join("\n");
    const pay = `<div class="panel" style="margin-bottom:18px"><h2 class="panel-h">${d.payment.title}</h2>
      <div class="top3-grid" style="margin-top:14px">${d.payment.options.map(o => `
        <div class="top3-card"><h3 class="panel-h" style="font-size:15px">${o.name}<span class="risk risk-${o.riskLevel === "低" || o.riskLevel === "low" ? "low" : "mid"}" style="margin-left:8px">${o.riskLevel}风险</span></h3><p style="font-size:13.5px;line-height:1.7;color:var(--ink-2)">${o.detail}</p></div>`).join("")}
      </div></div>`;
    const chips = prices.regionsMeta.filter(m => m.addr).slice(0, 14).map(m =>
      `<a class="chip" href="${d.addressTools.baseUrl}${m.addr}-address/" target="_blank" rel="nofollow noopener">${m.flag} ${m.name}</a>`).join("");
    const faq = d.faq.map((f, i) => `<details${i === 0 ? " open" : ""}><summary>${f.q}</summary><p>${f.a}</p></details>`).join("\n");
    body = `
<section class="index-hero"><div class="wrap">
  <h1>${d.title}</h1>
  <p class="section-sub">${d.intro}</p>
</div></section>
<section class="section" style="padding-top:8px"><div class="wrap">
  ${methods}
  ${pay}
  <div class="panel" style="margin-bottom:18px">
    <h2 class="panel-h">当地账单地址</h2>
    <p class="fine" style="margin:10px 0 12px">${d.addressTools.note}</p>
    <div class="chips">${chips}</div>
  </div>
  ${articles.length ? `<div class="panel" style="margin-bottom:18px"><h2 class="panel-h">相关攻略</h2><div class="chips" style="margin-top:10px">${articles.map(([slug, label]) => `<a class="chip" href="${slug}.html">${label}</a>`).join("")}</div></div>` : ""}
  <h2 style="margin-top:32px">常见问题</h2>
  <div class="faq-list">${faq}</div>
  <p class="fine" style="margin-top:20px">${d.disclaimer}</p>
</div></section>`;
  }
  await writeFile(path.join(ROOT, "apple-id-registration.html"), shell({
    title: "Apple ID 换区注册完整指南 2026 | AI 定价站",
    desc: "Apple ID 换区两种方案的完整步骤、支付方式对比、账单地址工具与风险 FAQ，全部按 2026 年 iOS 设置路径核验。",
    body, crumbs: [{ label: "首页", href: "index.html" }, { label: "换区指南" }],
  }));
}

/* ================= VPN 板块（T3/T4/T5） ================= */
const LB_DEFS = [
  { key: "best", label: "2026 综合最佳" },
  { key: "free", label: "最佳免费" },
  { key: "secure", label: "最注重隐私" },
  { key: "value", label: "性价比之选" },
  { key: "streaming", label: "流媒体解锁" },
];

async function buildVPN() {
  const facts = await readJSON("data/content/vpn-facts.json");
  const lbs = await readJSON("data/content/leaderboards.json");

  // vpn.html：事实库 + 榜单入口（自建测速节点未建成——如实说明，不造数据）
  let factsBlock;
  const list = facts?.vpns || facts?.entries || (Array.isArray(facts) ? facts : null);
  if (list) {
    const rows = list.map(v => `<tr>
      <td class="plan-name"><a href="${v.site}" target="_blank" rel="noopener">${v.name}</a></td>
      <td>${v.jurisdiction || "—"}</td>
      <td>${(v.protocols || []).join(" / ") || "—"}</td>
      <td>${v.openSource === "full" ? "全开源" : v.openSource === "client" ? "客户端开源" : v.openSource === "no" ? "闭源" : "待核验"}</td>
      <td>${v.latestAudit ? `<a href="${v.latestAudit.url}" target="_blank" rel="noopener">${v.latestAudit.firm} ${v.latestAudit.year} ↗</a>` : "无公开审计"}</td>
      <td>${v.freeTier ? (v.freeTier.limit || "有") : "无"}</td>
      <td class="pt-tax">${v.zhNote || ""}</td>
    </tr>`).join("");
    factsBlock = `<section class="section" style="padding-top:8px"><div class="wrap">
      <h2>VPN 事实库<span class="h2-tag">逐款官方来源核验</span></h2>
      <div class="table-scroll"><table class="cmp-table">
        <thead><tr><th>名称</th><th>注册地</th><th>协议</th><th>开源</th><th>最新公开审计</th><th>免费档</th><th>点评</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="fine">事实字段（辖区/协议/开源/审计/免费额度）逐款核验自官网、GitHub 与审计机构公告页；点评为本站编辑观点。</p>
    </div></section>`;
  } else factsBlock = pendingBlock("VPN 事实库");

  const lbLinks = LB_DEFS.map(l => `<a class="vt-pill" href="leaderboard-${l.key}.html">${l.label}</a>`).join("");
  const vpnBody = `
<section class="index-hero"><div class="wrap">
  <h1>VPN 榜单与事实库</h1>
  <p class="section-sub">以可核验事实（协议、审计、辖区、免费额度）为依据的 VPN 评价体系。本站不参与任何联盟返佣，立场先行公示。</p>
  <div class="vert-tabs">${lbLinks}</div>
</div></section>
<section class="section" style="padding-top:8px"><div class="wrap"><div class="panel">
  <h3 class="block-h" style="margin-top:0">关于速度数据</h3>
  <p class="section-sub" style="margin:0">同类站点的"实时测速"依赖自建测速节点。本站测速节点尚未建成，因此现阶段不展示任何速度数字——宁可空着，也不引用无法核验的第三方跑分。节点上线后此处将展示逐日趋势与测量方式全文。</p>
</div></div></section>
${factsBlock}`;
  await writeFile(path.join(ROOT, "vpn.html"), shell({
    title: "VPN 榜单与事实库 | AI 定价站",
    desc: "以协议、公开审计、注册辖区、免费额度等可核验事实为依据的 VPN 对比与五张编辑榜单，无联盟返佣立场。",
    body: vpnBody, crumbs: [{ label: "首页", href: "index.html" }, { label: "VPN" }],
  }));

  // 五张榜单页
  for (const def of LB_DEFS) {
    const board = lbs?.boards?.[def.key];
    let body;
    if (!board) body = `<section class="index-hero"><div class="wrap"><h1>${def.label} VPN 榜单</h1></div></section>` + pendingBlock("榜单内容");
    else {
      const entry = e => `
      <div class="entity-card">
        <div class="ec-head"><div class="ec-id">
          <div class="app-icon ec-icon icon-full"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#101a2c"/><text x="32" y="43" font-family="system-ui,sans-serif" font-size="26" font-weight="800" text-anchor="middle" fill="#4da3ff">${e.rank}</text></svg></div>
          <div><h2>${e.name}</h2><p class="ec-sub">${e.bestFor || ""}</p></div>
        </div></div>
        <p class="gc-note">${e.verdict}</p>
        <div class="lb-pc"><div><p class="fine" style="font-weight:700;color:var(--good)">优点</p><ul>${(e.pros || []).map(x => `<li>${x}</li>`).join("")}</ul></div>
        <div><p class="fine" style="font-weight:700;color:#ffb340">注意</p><ul>${(e.cons || []).map(x => `<li>${x}</li>`).join("")}</ul></div></div>
      </div>`;
      const caution = board.cautionEntries?.length ? `
      <h2 style="margin-top:36px">谨慎使用</h2>
      <div class="card-grid" style="margin-top:16px">${board.cautionEntries.map(entry).join("")}</div>` : "";
      body = `
<section class="index-hero"><div class="wrap">
  <h1>${board.title}</h1>
  <p class="section-sub">${board.subtitle || ""} ${board.criteria ? `排序标准：${board.criteria}` : ""}</p>
  <div class="vert-tabs">${LB_DEFS.map(l => `<a class="vt-pill${l.key === def.key ? " active" : ""}" href="leaderboard-${l.key}.html">${l.label}</a>`).join("")}</div>
</div></section>
<section class="section" style="padding-top:8px"><div class="wrap">
  <div class="card-grid">${board.entries.map(entry).join("")}</div>
  ${caution}
  <p class="fine" style="margin-top:18px">${lbs.methodology || ""}</p>
</div></section>`;
    }
    await writeFile(path.join(ROOT, `leaderboard-${def.key}.html`), shell({
      title: `${def.label} VPN 榜单 2026 | AI 定价站`,
      desc: `${def.label} VPN 编辑榜单：判断依据全部为可核验事实（协议/审计/辖区/免费额度），无联盟返佣立场。`,
      body, crumbs: [{ label: "首页", href: "index.html" }, { label: "VPN", href: "vpn.html" }, { label: def.label }],
    }));
  }
}

/* ================= 国家专页 ×9（数据驱动） ================= */
const COUNTRY_PAGES = [
  ["chatgpt", "in", "chatgpt-india"], ["chatgpt", "jp", "chatgpt-japan"],
  ["chatgpt", "kr", "chatgpt-south-korea"], ["chatgpt", "tr", "chatgpt-turkey"],
  ["claude", "jp", "claude-japan"], ["claude", "ng", "claude-nigeria"],
  ["claude", "kr", "claude-south-korea"], ["claude", "tr", "claude-turkey"],
  ["grok", "in", "grok-india"],
];

async function buildCountryPages() {
  for (const [key, cc, slug] of COUNTRY_PAGES) {
    const p = prices.products[key];
    const m = META[cc];
    const r = p.regions?.[cc] || {};
    const us = p.regions?.us || {};
    const tiers = p.tiers.map(t => {
      const v = r[t.key], uv = us[t.key];
      const delta = v != null && uv ? Math.round((v - uv) / uv * 100) : null;
      return `<div class="top3-card"><h3 class="panel-h" style="font-size:15px">${t.label}</h3>
        <p style="font-size:24px;font-weight:750;margin:8px 0 2px">${v != null ? fmtUSD(v) + "/mo" : "待核验"}</p>
        <p class="fine">${v != null && r.local && t.key === p.baseTier ? `本币 ${r.local} · ` : ""}${delta != null ? (delta === 0 ? "与美区持平" : delta < 0 ? `比美区便宜 ${-delta}%` : `比美区贵 ${delta}%`) : "官方商店未公示，管线核验中"}</p>
      </div>`;
    }).join("");
    const body = `
<section class="index-hero"><div class="wrap">
  <h1>${m.flag} ${m.name} ${p.label} 价格${r[p.baseTier] != null ? `：${fmtUSD(r[p.baseTier])}/mo` : ""}</h1>
  <p class="section-sub">${p.label} 在${m.name} App Store 的订阅挂牌价（${m.tax}），与美区基准的实时对比。数据每日自动核验，更新于 ${prices.updatedAt}。</p>
</div></section>
<section class="section" style="padding-top:8px"><div class="wrap">
  <div class="top3-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">${tiers}</div>
  <div class="panel" style="margin-top:18px">
    <h3 class="block-h" style="margin-top:0">怎么订阅${m.name}区 ${p.label}？</h3>
    <p class="section-sub" style="margin:0 0 10px">需要一个${m.name}区 Apple ID（账单地址可用<a href="https://www.randaddress.com/zh/genaddress/${m.addr}-address/" target="_blank" rel="nofollow noopener">地址生成器</a>）+ 该区礼品卡支付。完整步骤见<a href="apple-id-registration.html">换区注册指南</a>；风险提示：${m.risk === "low" ? "该区注册门槛较低" : "该区有额外支付/实名门槛"}，虚构地址违反 Apple 条款，请自行评估。</p>
  </div>
  <p style="margin-top:18px"><a href="${key}.html">← 查看 ${p.label} 全球 ${Object.keys(p.regions || {}).length} 区完整对比</a></p>
</div></section>`;
    await writeFile(path.join(ROOT, `${slug}.html`), shell({
      title: `${m.name} ${p.label} 价格 2026 | ${p.label} ${m.name}区订阅指南`,
      desc: `${p.label} 在${m.name}的订阅价格与美区对比、订阅步骤与风险说明。数据每日自动核验自官方商店。`,
      body, crumbs: [{ label: "首页", href: "index.html" }, { label: "AI 区域定价", href: "ai.html" }, { label: `${p.label} ${m.name}` }],
    }));
  }
}

/* ================= 攻略长尾页 ×3（内容 JSON 到货才生成，不留死链） ================= */
const ARTICLES = [
  ["article-claude-guest-pass", "claude-guest-pass", "claude", "Claude 免费试用现状"],
  ["article-gemini-student-discount", "gemini-student-discount", "gemini", "Gemini 学生优惠"],
  ["article-grok-discount-guide", "grok-discount-guide", "grok", "Grok 省钱指南"],
];

async function buildArticles() {
  const built = [];
  for (const [src, slug, productKey, shortLabel] of ARTICLES) {
    const d = await readJSON(`data/content/${src}.json`);
    if (!d) continue;
    const p = prices.products[productKey];
    const sections = d.sections.map(sec => `
      <h2 style="margin-top:34px">${sec.h2}</h2>
      ${(sec.paras || []).map(t => `<p class="art-p">${t}</p>`).join("")}
      ${sec.steps ? `<div class="howto-grid" style="margin-top:14px">${sec.steps.map((st, i) =>
        `<div class="step-card"><div class="step-num">${i + 1}</div><h3>${st.title}</h3><p>${st.detail}</p></div>`).join("")}</div>` : ""}
      ${sec.callout ? `<div class="callout" style="margin-top:14px">💡 ${sec.callout}</div>` : ""}`).join("\n");
    const faq = (d.faq || []).map((f, i) => `<details${i === 0 ? " open" : ""}><summary>${f.q}</summary><p>${f.a}</p></details>`).join("\n");
    const body = `
<section class="index-hero"><div class="wrap">
  <h1>${d.title}</h1>
  <p class="section-sub">${d.intro}</p>
</div></section>
<section class="section" style="padding-top:8px"><div class="wrap" style="max-width:820px">
  ${sections}
  ${faq ? `<h2 style="margin-top:34px">常见问题</h2><div class="faq-list">${faq}</div>` : ""}
  <p class="fine" style="margin-top:22px">${d.verifiedNote || ""}</p>
  <p class="fine">${d.disclaimer || ""}</p>
  <p style="margin-top:16px"><a href="${productKey}.html">← 查看 ${p.label} 全球价格对比</a> · <a href="apple-id-registration.html">Apple ID 换区指南</a></p>
</div></section>`;
    await writeFile(path.join(ROOT, `${slug}.html`), shell({
      title: `${d.title} | AI 定价站`,
      desc: d.intro.slice(0, 110),
      body, crumbs: [{ label: "首页", href: "index.html" }, { label: "AI 区域定价", href: "ai.html" }, { label: shortLabel }],
    }));
    built.push([slug, shortLabel]);
  }
  return built;
}

const builtArticles = await buildArticles();
await buildGiftCards();
await buildGuide(builtArticles);
await buildVPN();
await buildCountryPages();
console.log("extra pages built" + (builtArticles.length ? ` (+${builtArticles.length} articles)` : ""));
