/* =====================================================================
   Claude 定价站 · app.js
   所有价格来自 data/prices.json（由 scripts/fetch-prices.mjs 管线每日维护）
   页面不硬编码任何价格数字。
   ===================================================================== */

const $ = id => document.getElementById(id);

const fmtUSD = (v, digits = 2) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtP = v => fmtUSD(v, v % 1 ? 2 : 0);

const vBadge = (verifiedAt, source) => verifiedAt
  ? `<span class="vb vb-ok" title="${source || ""}">已核验 ${String(verifiedAt).slice(5)}</span>`
  : `<span class="vb vb-wait" title="${source || ""}">待核验</span>`;

let D = null;
let currentPlan = "pro";
const PLAN_LABEL = { pro: "Pro", max5x: "Max 5x", max20x: "Max 20x" };

/* ================= 产品头摘要（对齐对手站文案结构，数字实时计算） ================= */

function renderHero() {
  const rows = D.claude.regions.filter(r => r.pro != null).sort((a, b) => a.pro - b.pro);
  if (rows.length < 2) return;
  const lo = rows[0], hi = rows[rows.length - 1];
  const diff = Math.round((hi.pro - lo.pro) / lo.pro * 100);
  const year = D.updatedAt.slice(0, 4);
  $("heroSummary").innerHTML =
    `比较 Claude 订阅在全球 App Store 与 Google Play 各区域的价格。` +
    `<strong>${lo.name}（${fmtUSD(lo.pro)}/mo）</strong>是 ${year} 年 Claude 最便宜的地区。` +
    `相比最贵的<strong>${hi.name}（${fmtUSD(hi.pro)}/mo）</strong>，价格相差 <strong>${diff}%</strong>。`;
  $("faqCheapest").textContent =
    `按最新核验数据，${lo.name}（${fmtUSD(lo.pro)}/mo）是 App Store 各区中 Pro 月价最低的地区，其次是` +
    `${rows[1].name}（${fmtUSD(rows[1].pro)}/mo）。数据每日自动核验更新，见"最便宜的国家"排行。`;
}

/* ================= 价格热力图（相对美区，发散配色） ================= */

function renderHeatTiles() {
  const el = $("heatTiles");
  const usPro = D.claude.regions.find(r => r.cc === "us")?.pro;
  const rows = D.claude.regions.filter(r => r.pro != null);
  if (!rows.length || usPro == null) {
    el.innerHTML = `<p class="fine">各区价格核验后显示。</p>`;
    return;
  }
  el.innerHTML = [...rows].sort((a, b) => a.pro - b.pro).map(r => {
    const d = (r.pro - usPro) / usPro * 100;
    const cls = d <= -5 ? "heat-cheap" : d < 5 ? "heat-base" : d < 20 ? "heat-warm" : "heat-hot";
    const txt = d === 0 ? "基准" : (d > 0 ? "+" : "") + d.toFixed(0) + "%";
    return `<div class="heat-tile ${cls}" title="${r.name} ${fmtUSD(r.pro)}">
      <span class="heat-flag">${r.flag}</span>
      <span class="heat-name">${r.name}</span>
      <b>${fmtUSD(r.pro, 0)}</b>
      <span class="heat-delta">${txt}</span>
    </div>`;
  }).join("");
}

/* ================= 各区条形图 ================= */

function renderRegionChart() {
  const key = currentPlan;
  const { web } = D.claude;
  const webRef = key === "pro" ? web.proAnnual : key === "max5x" ? web.max5x : web.max20x;
  const rows = D.claude.regions.filter(r => r[key] != null).sort((a, b) => a[key] - b[key]);
  $("regionChartTitle").textContent = `${PLAN_LABEL[key]} 各区月价（美元折算）`;

  if (!rows.length) {
    $("regionChart").innerHTML = `<p class="fine" style="margin:8px 0">该档位各区价格核验后显示。网页直订价：${fmtP(webRef)}/月。</p>`;
    return;
  }
  const usRow = rows.find(r => r.cc === "us");
  const maxVal = Math.max(...rows.map(r => r[key])) * 1.06;
  $("regionChart").innerHTML = rows.map(r => `
    <div class="hbar-row" title="${r.name} · ${fmtUSD(r[key])}">
      <span class="hbar-label">${r.flag} ${r.name}</span>
      <div class="hbar-track">
        <div class="hbar-fill" style="width:${(r[key] / maxVal * 100).toFixed(1)}%"></div>
        <div class="ref-line" style="left:${(webRef / maxVal * 100).toFixed(2)}%" aria-hidden="true"></div>
        ${usRow ? `<div class="ref-line us" style="left:${(usRow[key] / maxVal * 100).toFixed(2)}%" aria-hidden="true"></div>` : ""}
      </div>
      <span class="hbar-val">${fmtUSD(r[key])}</span>
    </div>`).join("");
}

function initPlanTabs() {
  const btns = document.querySelectorAll(".seg-btn[data-plan]");
  btns.forEach(btn => {
    btn.addEventListener("click", () => {
      btns.forEach(b => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      currentPlan = btn.dataset.plan;
      renderRegionChart();
    });
  });
}

/* ================= Top3 榜单 ================= */

function renderTop3() {
  const rows = D.claude.regions.filter(r => r.pro != null).sort((a, b) => a.pro - b.pro);
  const pendingLi = `<li class="fine">待核验后显示</li>`;
  const usPro = D.claude.regions.find(r => r.cc === "us")?.pro;
  const li = r => {
    const d = usPro ? Math.round((r.pro - usPro) / usPro * 100) : null;
    const dTxt = d == null ? "" : `<span class="${d > 0 ? "delta-pos" : "delta-neg"}">${d === 0 ? "基准" : (d > 0 ? "+" : "") + d + "%"}</span>`;
    return `<li><span class="t3-flag">${r.flag}</span><span class="t3-name">${r.name}</span>${dTxt}<b>${fmtUSD(r.pro)}</b></li>`;
  };
  $("top3Cheap").innerHTML = rows.length ? rows.slice(0, 3).map(li).join("") : pendingLi;
  $("top3Rich").innerHTML = rows.length ? rows.slice(-3).reverse().map(li).join("") : pendingLi;
}

/* ================= App Store 完整价格表 ================= */

function renderRegionTable() {
  const usPro = D.claude.regions.find(r => r.cc === "us")?.pro;
  const pending = `<span class="vb vb-wait">待核验</span>`;
  const rows = [...D.claude.regions].sort((a, b) => (a.pro ?? 1e9) - (b.pro ?? 1e9));
  $("regionTableBody").innerHTML = rows.map((r, i) => {
    let deltaCell = `<span class="muted">—</span>`;
    if (r.pro != null && usPro != null) {
      const delta = (r.pro - usPro) / usPro * 100;
      const deltaTxt = delta === 0 ? "基准" : (delta > 0 ? "+" : "") + delta.toFixed(0) + "%";
      deltaCell = `<span class="${delta > 0 ? "delta-pos" : "delta-neg"}">${deltaTxt}</span>`;
    }
    const addr = r.addr
      ? `<a href="https://www.randaddress.com/zh/genaddress/${r.addr}-address/" target="_blank" rel="nofollow noopener">获取地址 ↗</a>`
      : `<span class="muted">—</span>`;
    return `<tr>
      <td class="num">${i + 1}</td>
      <td class="plan-name">${r.flag} ${r.name}</td>
      <td class="num">${r.pro != null ? `${fmtUSD(r.pro)}<div class="fine">≈ ${r.local}/mo</div>` : pending}</td>
      <td class="num">${deltaCell}</td>
      <td class="num">${r.max5x != null ? fmtUSD(r.max5x) : pending}</td>
      <td class="num">${r.max20x != null ? fmtUSD(r.max20x) : pending}</td>
      <td>${r.tax}</td>
      <td><span class="risk risk-${r.risk === "中" ? "mid" : "low"}">${r.risk}</span>${r.riskNote ? `<div class="fine">${r.riskNote}</div>` : ""}</td>
      <td>${addr}</td>
    </tr>`;
  }).join("");
}

/* ================= Google Play 表 ================= */

function renderPlayTable() {
  $("playTableBody").innerHTML = D.claude.regions.map((r, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td class="plan-name">${r.flag} ${r.name}</td>
      <td class="num">${r.play ? r.play : `<span class="muted">Play 未公示</span>`}</td>
      <td>${r.play ? `<span class="vb vb-ok">已核验</span>` : `<span class="vb vb-wait">待核验</span>`}</td>
    </tr>`).join("");
}

/* ================= PPP 购买力对比（哑铃图） ================= */

function renderPPP() {
  const el = $("pppChart");
  const rows = D.claude.regions
    .filter(r => r.pro != null && r.ppp != null)
    .sort((a, b) => b.ppp - a.ppp);
  if (!rows.length) {
    el.innerHTML = `<p class="fine">购买力对比在各区价格与 IMF 换算率核验后显示。</p>`;
    return;
  }
  const maxV = Math.max(...rows.map(r => Math.max(r.ppp, r.pro))) * 1.08;
  el.innerHTML = rows.map(r => {
    const x1 = Math.min(r.pro, r.ppp) / maxV * 100, x2 = Math.max(r.pro, r.ppp) / maxV * 100;
    return `<div class="ppp-row" title="${r.name}：标价 ${fmtUSD(r.pro)} · 购买力负担 ≈ ${fmtUSD(r.ppp, 0)}">
      <span class="ppp-label">${r.flag} ${r.name}</span>
      <div class="ppp-track">
        <div class="ppp-line" style="left:${x1}%;width:${(x2 - x1)}%"></div>
        <span class="ppp-dot ppp-list" style="left:${r.pro / maxV * 100}%"></span>
        <span class="ppp-dot ppp-burden" style="left:${r.ppp / maxV * 100}%"></span>
      </div>
      <span class="ppp-val">${fmtUSD(r.ppp, 0)} <i>${r.ppp >= r.pro ? "+" : ""}${Math.round((r.ppp / r.pro - 1) * 100)}%</i></span>
    </div>`;
  }).join("");
}

/* ================= 分享卡片（canvas 生成 PNG） ================= */

function initShare() {
  $("shareBtn").addEventListener("click", () => {
    const rows = D.claude.regions.filter(r => r.pro != null).sort((a, b) => a.pro - b.pro);
    if (rows.length < 3) { alert("价格数据核验后即可生成分享卡片"); return; }

    const W = 1080, H = 1080;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    const ink = "#0b0b0b", muted = "#898781", accent = "#b5542f", good = "#006300";
    x.fillStyle = "#f9f9f7"; x.fillRect(0, 0, W, H);
    x.fillStyle = accent; x.fillRect(0, 0, W, 14);
    x.fillStyle = ink; x.font = "700 54px system-ui, sans-serif";
    x.fillText("Claude 各国价格对比", 72, 140);
    x.fillStyle = muted; x.font = "400 30px system-ui, sans-serif";
    x.fillText(`${PLAN_LABEL[currentPlan]} · 数据版本 ${D.updatedAt} · 核验自官方商店页`, 72, 196);

    const key = currentPlan;
    const list = D.claude.regions.filter(r => r[key] != null).sort((a, b) => a[key] - b[key]);
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

    y = 990;
    x.fillStyle = ink; x.font = "650 30px system-ui, sans-serif";
    x.fillText("Claude 定价站 · 每日自动核验 · 每个数字可追溯", 72, y);

    const a = document.createElement("a");
    a.download = `claude-pricing-${currentPlan}-${D.updatedAt}.png`;
    a.href = c.toDataURL("image/png");
    a.click();
  });
}

/* ================= 换区指南：地址链接 ================= */

function renderAddrChips() {
  $("addrChips").innerHTML = D.claude.regions.filter(r => r.addr).map(r =>
    `<a class="chip" href="https://www.randaddress.com/zh/genaddress/${r.addr}-address/" target="_blank" rel="nofollow noopener">${r.flag} ${r.name}</a>`
  ).join("");
}

/* ================= 数据来源账本 ================= */

function renderProvenance() {
  $("provTableBody").innerHTML = (D.provenance || []).map(p => `
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
  document.querySelectorAll(".data-date").forEach(el => { el.textContent = D.updatedAt; });
  renderHero();
  renderHeatTiles();
  renderRegionChart();
  renderTop3();
  renderRegionTable();
  renderPlayTable();
  renderPPP();
  initPlanTabs();
  initShare();
  renderAddrChips();
  renderProvenance();
}

boot();
