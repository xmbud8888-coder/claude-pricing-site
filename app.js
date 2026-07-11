/* =====================================================================
   定价站 · app.js（产品无关）
   页面通过 <body data-product="claude|chatgpt|grok"> 选择产品；
   所有价格来自 data/prices.json（管线每日维护），页面不硬编码数字。
   ===================================================================== */

const $ = id => document.getElementById(id);

const fmtUSD = (v, digits = 2) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtP = v => fmtUSD(v, v % 1 ? 2 : 0);

const vBadge = (verifiedAt, source) => verifiedAt
  ? `<span class="vb vb-ok" title="${source || ""}">已核验 ${String(verifiedAt).slice(5)}</span>`
  : `<span class="vb vb-wait" title="${source || ""}">待核验</span>`;

const PRODUCT = document.body.dataset.product || "claude";
let D = null;      // 全量数据
let P = null;      // 当前产品
let R = [];        // 合并了 meta + 当前产品价格的地区行
let currentTier = null;

const rowsWithBase = () => R.filter(r => r[P.baseTier] != null);

/* ================= 产品头摘要 ================= */

function renderHero() {
  const rows = rowsWithBase().sort((a, b) => a[P.baseTier] - b[P.baseTier]);
  const year = D.updatedAt.slice(0, 4);
  if (rows.length < 2) {
    $("heroSummary").innerHTML =
      `比较 ${P.label} 订阅在全球 App Store 与 Google Play 各区域的价格。各区价格由自动管线每日抓取官方商店页，核验完成后即在此展示最便宜/最贵地区结论。`;
    if ($("faqCheapest")) $("faqCheapest").textContent = "各区价格核验完成后，此处显示最新结论（数据每日自动更新）。";
    return;
  }
  const base = P.tiers.find(t => t.key === P.baseTier)?.label || "";
  const lo = rows[0], hi = rows[rows.length - 1];
  const diff = Math.round((hi[P.baseTier] - lo[P.baseTier]) / lo[P.baseTier] * 100);
  $("heroSummary").innerHTML =
    `比较 ${P.label} 订阅在全球 App Store 与 Google Play 各区域的价格。` +
    `<strong>${lo.name}（${fmtUSD(lo[P.baseTier])}/mo）</strong>是 ${year} 年 ${P.label} ${base} 最便宜的地区。` +
    `相比最贵的<strong>${hi.name}（${fmtUSD(hi[P.baseTier])}/mo）</strong>，价格相差 <strong>${diff}%</strong>。`;
  if ($("faqCheapest")) $("faqCheapest").textContent =
    `按最新核验数据，${lo.name}（${fmtUSD(lo[P.baseTier])}/mo）是 App Store 各区中 ${P.label} ${base} 月价最低的地区，其次是` +
    `${rows[1].name}（${fmtUSD(rows[1][P.baseTier])}/mo）。数据每日自动核验更新。`;
}

/* ================= 档位切换（动态生成） ================= */

function renderTierTabs() {
  const seg = $("tierSeg");
  currentTier = P.baseTier;
  seg.innerHTML = P.tiers.map(t =>
    `<button class="seg-btn ${t.key === currentTier ? "active" : ""}" data-plan="${t.key}" role="tab" aria-selected="${t.key === currentTier}">${t.label}</button>`
  ).join("");
  seg.querySelectorAll(".seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      seg.querySelectorAll(".seg-btn").forEach(b => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      currentTier = btn.dataset.plan;
      renderRegionChart();
    });
  });
}

/* ================= 价格热力图 ================= */

function renderHeatTiles() {
  const el = $("heatTiles");
  const us = R.find(r => r.cc === "us")?.[P.baseTier];
  const rows = rowsWithBase();
  if (!rows.length || us == null) {
    el.innerHTML = `<p class="fine">各区价格由管线核验后显示（每日自动运行）。</p>`;
    return;
  }
  el.innerHTML = [...rows].sort((a, b) => a[P.baseTier] - b[P.baseTier]).map(r => {
    const v = r[P.baseTier];
    const d = (v - us) / us * 100;
    const cls = d <= -5 ? "heat-cheap" : d < 5 ? "heat-base" : d < 20 ? "heat-warm" : "heat-hot";
    const txt = d === 0 ? "基准" : (d > 0 ? "+" : "") + d.toFixed(0) + "%";
    return `<div class="heat-tile ${cls}" title="${r.name} ${fmtUSD(v)}">
      <span class="heat-flag">${r.flag}</span>
      <span class="heat-name">${r.name}</span>
      <b>${fmtUSD(v, 0)}</b>
      <span class="heat-delta">${txt}</span>
    </div>`;
  }).join("");
}

/* ================= 各区条形图 ================= */

function renderRegionChart() {
  const key = currentTier;
  const label = P.tiers.find(t => t.key === key)?.label || key;
  const webRef = P.web?.[key] ?? null;
  const rows = R.filter(r => r[key] != null).sort((a, b) => a[key] - b[key]);
  $("regionChartTitle").textContent = `${label} 各区月价（美元折算）`;

  if (!rows.length) {
    $("regionChart").innerHTML = `<p class="fine" style="margin:8px 0">该档位各区价格核验后显示。</p>`;
    return;
  }
  const usRow = rows.find(r => r.cc === "us");
  const maxVal = Math.max(...rows.map(r => r[key])) * 1.06;
  $("regionChart").innerHTML = rows.map(r => `
    <div class="hbar-row" title="${r.name} · ${fmtUSD(r[key])}">
      <span class="hbar-label">${r.flag} ${r.name}</span>
      <div class="hbar-track">
        <div class="hbar-fill" style="width:${(r[key] / maxVal * 100).toFixed(1)}%"></div>
        ${webRef != null ? `<div class="ref-line" style="left:${(webRef / maxVal * 100).toFixed(2)}%" aria-hidden="true"></div>` : ""}
        ${usRow ? `<div class="ref-line us" style="left:${(usRow[key] / maxVal * 100).toFixed(2)}%" aria-hidden="true"></div>` : ""}
      </div>
      <span class="hbar-val">${fmtUSD(r[key])}</span>
    </div>`).join("");
  // 图例：没有已核验网页价的产品隐藏"网页直订价"项
  const webLg = document.querySelector(".lg-item-web");
  if (webLg) webLg.style.display = webRef != null ? "" : "none";
}

/* ================= Top3 榜单 ================= */

function renderTop3() {
  const rows = rowsWithBase().sort((a, b) => a[P.baseTier] - b[P.baseTier]);
  const pendingLi = `<li class="fine">待核验后显示</li>`;
  const us = R.find(r => r.cc === "us")?.[P.baseTier];
  const li = r => {
    const v = r[P.baseTier];
    const d = us ? Math.round((v - us) / us * 100) : null;
    const dTxt = d == null ? "" : `<span class="${d > 0 ? "delta-pos" : "delta-neg"}">${d === 0 ? "基准" : (d > 0 ? "+" : "") + d + "%"}</span>`;
    return `<li><span class="t3-flag">${r.flag}</span><span class="t3-name">${r.name}</span>${dTxt}<b>${fmtUSD(v)}</b></li>`;
  };
  $("top3Cheap").innerHTML = rows.length ? rows.slice(0, 3).map(li).join("") : pendingLi;
  $("top3Rich").innerHTML = rows.length ? rows.slice(-3).reverse().map(li).join("") : pendingLi;
}

/* ================= App Store 完整价格表（表头随档位动态生成） ================= */

function renderRegionTable() {
  const base = P.baseTier;
  const us = R.find(r => r.cc === "us")?.[base];
  const pending = `<span class="vb vb-wait">待核验</span>`;
  const baseLabel = P.tiers.find(t => t.key === base)?.label;

  $("regionTableHead").innerHTML = `<tr>
    <th>#</th><th>地区</th><th>${baseLabel}</th><th>对比美国价</th>
    ${P.tiers.filter(t => t.key !== base).map(t => `<th>${t.label}</th>`).join("")}
    <th>税费</th><th>风险</th><th>示例地址</th>
  </tr>`;

  const rows = [...R].sort((a, b) => (a[base] ?? 1e9) - (b[base] ?? 1e9));
  $("regionTableBody").innerHTML = rows.map((r, i) => {
    let deltaCell = `<span class="muted">—</span>`;
    if (r[base] != null && us != null) {
      const delta = (r[base] - us) / us * 100;
      const deltaTxt = delta === 0 ? "基准" : (delta > 0 ? "+" : "") + delta.toFixed(0) + "%";
      deltaCell = `<span class="${delta > 0 ? "delta-pos" : "delta-neg"}">${deltaTxt}</span>`;
    }
    const addr = r.addr
      ? `<a href="https://www.randaddress.com/zh/genaddress/${r.addr}-address/" target="_blank" rel="nofollow noopener">获取地址 ↗</a>`
      : `<span class="muted">—</span>`;
    return `<tr>
      <td class="num">${i + 1}</td>
      <td class="plan-name">${r.flag} ${r.name}</td>
      <td class="num">${r[base] != null ? `${fmtUSD(r[base])}${r.local ? `<div class="fine">≈ ${r.local}/mo</div>` : ""}` : pending}</td>
      <td class="num">${deltaCell}</td>
      ${P.tiers.filter(t => t.key !== base).map(t =>
        `<td class="num">${r[t.key] != null ? fmtUSD(r[t.key]) : pending}</td>`).join("")}
      <td>${r.tax}</td>
      <td><span class="risk risk-${r.risk === "中" ? "mid" : "low"}">${r.risk}</span>${r.riskNote ? `<div class="fine">${r.riskNote}</div>` : ""}</td>
      <td>${addr}</td>
    </tr>`;
  }).join("");

  const tf = $("tableFoot");
  if (P.web?.note && !tf.dataset.webNoted) {
    tf.textContent += " " + P.web.note + "（官方核验）。";
    tf.dataset.webNoted = "1";
  }
}

/* ================= Google Play 表 ================= */

function renderPlayTable() {
  $("playTableBody").innerHTML = R.map((r, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td class="plan-name">${r.flag} ${r.name}</td>
      <td class="num">${r.play ? r.play : `<span class="muted">未公示 / 待核验</span>`}</td>
      <td>${r.play ? `<span class="vb vb-ok">已核验</span>` : `<span class="vb vb-wait">待核验</span>`}</td>
    </tr>`).join("");
}

/* ================= PPP 购买力对比 ================= */

function renderPPP() {
  const el = $("pppChart");
  const base = P.baseTier;
  const rows = R.filter(r => r[base] != null && r.ppp != null).sort((a, b) => b.ppp - a.ppp);
  if (!rows.length) {
    el.innerHTML = `<p class="fine">购买力对比在各区价格与 IMF 换算率核验后显示。</p>`;
    return;
  }
  const maxV = Math.max(...rows.map(r => Math.max(r.ppp, r[base]))) * 1.08;
  el.innerHTML = rows.map(r => {
    const v = r[base];
    const x1 = Math.min(v, r.ppp) / maxV * 100, x2 = Math.max(v, r.ppp) / maxV * 100;
    return `<div class="ppp-row" title="${r.name}：标价 ${fmtUSD(v)} · 购买力负担 ≈ ${fmtUSD(r.ppp, 0)}">
      <span class="ppp-label">${r.flag} ${r.name}</span>
      <div class="ppp-track">
        <div class="ppp-line" style="left:${x1}%;width:${(x2 - x1)}%"></div>
        <span class="ppp-dot ppp-list" style="left:${v / maxV * 100}%"></span>
        <span class="ppp-dot ppp-burden" style="left:${r.ppp / maxV * 100}%"></span>
      </div>
      <span class="ppp-val">${fmtUSD(r.ppp, 0)} <i>${r.ppp >= v ? "+" : ""}${Math.round((r.ppp / v - 1) * 100)}%</i></span>
    </div>`;
  }).join("");
}

/* ================= 分享卡片 ================= */

function initShare() {
  $("shareBtn").addEventListener("click", () => {
    const key = currentTier;
    const label = P.tiers.find(t => t.key === key)?.label || key;
    const list = R.filter(r => r[key] != null).sort((a, b) => a[key] - b[key]);
    if (list.length < 3) { alert("价格数据核验后即可生成分享卡片"); return; }

    const W = 1080, H = 1080;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    const ink = "#0b0b0b", muted = "#898781", accent = "#b5542f", good = "#006300";
    x.fillStyle = "#f9f9f7"; x.fillRect(0, 0, W, H);
    x.fillStyle = accent; x.fillRect(0, 0, W, 14);
    x.fillStyle = ink; x.font = "700 54px system-ui, sans-serif";
    x.fillText(`${P.label} 各国价格对比`, 72, 140);
    x.fillStyle = muted; x.font = "400 30px system-ui, sans-serif";
    x.fillText(`${label} · 数据版本 ${D.updatedAt} · 核验自官方商店页`, 72, 196);

    const top = [...list.slice(0, 4), ...list.slice(-3).reverse()];
    let y = 280;
    top.forEach((r, i) => {
      y += 92;
      x.font = "400 40px system-ui, sans-serif"; x.fillStyle = ink;
      x.fillText(`${i < 4 ? "↓" : "↑"} ${r.flag} ${r.name}`, 72, y);
      x.font = "700 40px system-ui, sans-serif";
      x.fillStyle = i < 4 ? good : accent;
      x.fillText(fmtUSD(r[key]), 780, y);
    });

    x.fillStyle = ink; x.font = "650 30px system-ui, sans-serif";
    x.fillText("每日自动核验 · 每个数字可追溯", 72, 990);

    const a = document.createElement("a");
    a.download = `${PRODUCT}-pricing-${key}-${D.updatedAt}.png`;
    a.href = c.toDataURL("image/png");
    a.click();
  });
}

/* ================= 换区指南地址链接 ================= */

function renderAddrChips() {
  $("addrChips").innerHTML = R.filter(r => r.addr).map(r =>
    `<a class="chip" href="https://www.randaddress.com/zh/genaddress/${r.addr}-address/" target="_blank" rel="nofollow noopener">${r.flag} ${r.name}</a>`
  ).join("");
}

/* ================= 数据来源账本（按产品过滤 + 共享项） ================= */

function renderProvenance() {
  const rows = (D.provenance || []).filter(p => !p.products || p.products.includes(PRODUCT));
  $("provTableBody").innerHTML = rows.map(p => `
    <tr>
      <td class="plan-name">${p.label}</td>
      <td>${p.status === "verified"
        ? `<span class="vb vb-ok">已核验 ${p.verifiedAt}</span>`
        : `<span class="vb vb-wait">待核验</span>`}</td>
      <td>${p.url ? `<a href="${p.url}" target="_blank" rel="noopener">${p.source} ↗</a>` : p.source}</td>
    </tr>`).join("");
}

/* ================= 启动 ================= */

async function boot() {
  try {
    const res = await fetch("data/prices.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    D = await res.json();
  } catch (e) {
    document.querySelector("main").insertAdjacentHTML("afterbegin",
      `<div class="wrap" style="padding:24px"><div class="callout">⚠️ 价格数据加载失败（${e.message}）。请通过 http 服务访问本站（而非直接打开文件），或检查 data/prices.json。</div></div>`);
    return;
  }
  P = D.products[PRODUCT];
  R = D.regionsMeta.map(m => ({ ...m, ...(P.regions[m.cc] || {}) }));

  document.querySelectorAll(".data-date").forEach(el => { el.textContent = D.updatedAt; });
  renderHero();
  renderTierTabs();
  renderHeatTiles();
  renderRegionChart();
  renderTop3();
  renderRegionTable();
  renderPlayTable();
  renderPPP();
  initShare();
  renderAddrChips();
  renderProvenance();
}

boot();
