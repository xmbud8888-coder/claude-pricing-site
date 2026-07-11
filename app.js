/* =====================================================================
   Claude 定价站 · app.js
   所有价格来自 data/prices.json（由 scripts/fetch-prices.mjs 管线维护）
   页面不硬编码任何价格数字。
   ===================================================================== */

const $ = id => document.getElementById(id);

const fmtUSD = (v, digits = 2) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtP = v => fmtUSD(v, v % 1 ? 2 : 0);            // 价目：整数不带小数
const fmtCost = v =>                                     // 成本：>=1000 整千分位
  v >= 1000 ? "$" + Math.round(v).toLocaleString()
  : v >= 10 ? fmtUSD(v, 0)
  : fmtUSD(v, 2);

const vBadge = (verifiedAt, source) => verifiedAt
  ? `<span class="vb vb-ok" title="${source || ""}">已核验 ${verifiedAt.slice(5)}</span>`
  : `<span class="vb vb-wait" title="${source || ""}">待管线核验</span>`;

let D = null; // 全局数据

/* ================= 渠道价差 ================= */

function barRows(el, rows, maxVal) {
  el.innerHTML = rows.map(r => {
    if (r.value == null) {
      return `<div class="chan-bar-row">
        <span class="chan-bar-label">${r.label}</span>
        <div class="chan-bar-track"><div class="chan-bar-pending">管线核验中</div></div>
        <span class="chan-bar-val muted">—</span>
      </div>`;
    }
    return `<div class="chan-bar-row">
      <span class="chan-bar-label">${r.label}</span>
      <div class="chan-bar-track">
        <div class="chan-bar-fill ${r.cls || ""}" style="width:${(r.value / maxVal * 100).toFixed(1)}%"></div>
      </div>
      <span class="chan-bar-val">${fmtP(r.value)}</span>
    </div>`;
  }).join("");
}

function renderChannels() {
  const { web, iosUS } = D.claude;
  barRows($("chanPro"), [
    { label: "网页年付", value: web.proAnnual, cls: "web" },
    { label: "网页月付", value: web.proMonthly },
    { label: "iOS 内购", value: iosUS.pro },
  ], Math.max(web.proMonthly, iosUS.pro || 0) * 1.35);

  barRows($("chanMax"), [
    { label: "网页月付", value: web.max5x, cls: "web" },
    { label: "iOS 内购", value: iosUS.max5x },
  ], Math.max(web.max5x, iosUS.max5x || 0) * 1.1);

  barRows($("chanMax20"), [
    { label: "网页月付", value: web.max20x, cls: "web" },
    { label: "iOS 内购", value: iosUS.max20x },
  ], (iosUS.max20x || web.max20x * 1.25) * 1.1);

  $("chanMaxNote").innerHTML = iosUS.max5x
    ? `iOS 内购比网页贵 <strong>${Math.round((iosUS.max5x / web.max5x - 1) * 100)}%</strong>（${fmtP(iosUS.max5x - web.max5x)}/月的纯溢价）。`
    : `iOS 内购价由管线核验后显示。网页价 ${fmtP(web.max5x)}/月已官方核验。`;
  $("chanMax20Note").innerHTML = iosUS.max20x
    ? `iOS 内购比网页贵 <strong>${Math.round((iosUS.max20x / web.max20x - 1) * 100)}%</strong>。`
    : `iOS 内购价由管线核验后显示。网页价 ${fmtP(web.max20x)}/月已官方核验。`;
}

/* ================= Claude API 表 ================= */

function renderApiTable() {
  $("apiTableBody").innerHTML = D.claude.api.map(m => {
    const intro = m.intro
      ? `<div class="fine" style="margin-top:2px">限时 <b style="color:var(--good)">${fmtP(m.intro.input)} / ${fmtP(m.intro.output)}</b> 至 ${m.intro.until}</div>`
      : "";
    return `<tr>
      <td class="plan-name">${m.name}${m.id === "fable-5" ? ' <span class="badge badge-accent">最强</span>' : ""}</td>
      <td class="num">${fmtP(m.input)}${intro}</td>
      <td class="num">${fmtP(m.output)}</td>
      <td class="num">${fmtUSD(m.input * 0.1, 2)}</td>
      <td class="num">${fmtP(m.input / 2)} / ${fmtP(m.output / 2)}</td>
      <td class="num">${m.ctx}</td>
      <td class="num">${m.maxOut}</td>
    </tr>`;
  }).join("");
}

/* ================= 计算器 ================= */

function effectivePrice(m, useIntro) {
  return (m.intro && useIntro) ? { input: m.intro.input, output: m.intro.output } : { input: m.input, output: m.output };
}

function monthlyCost(m, p) {
  const price = effectivePrice(m, p.useIntro);
  const disc = p.batch ? 0.5 : 1;
  const perReq =
    (p.inK * 1000 * (1 - p.cacheRate) / 1e6) * price.input * disc +
    (p.inK * 1000 * p.cacheRate / 1e6) * price.input * 0.1 * disc +
    (p.outK * 1000 / 1e6) * price.output * disc;
  return perReq * p.reqPerDay * 30;
}

function readParams() {
  return {
    inK: +$("calcIn").value, outK: +$("calcOut").value, reqPerDay: +$("calcReq").value,
    cacheRate: +$("calcCache").value / 100, batch: $("calcBatch").checked, useIntro: $("calcIntro").checked,
  };
}

function renderCalc() {
  const p = readParams();
  $("vIn").textContent = p.inK + "K";
  $("vOut").textContent = p.outK + "K";
  $("vReq").textContent = p.reqPerDay.toLocaleString();
  $("vCache").textContent = Math.round(p.cacheRate * 100) + "%";

  const sel = D.claude.api.find(m => m.id === $("calcModel").value);
  const total = monthlyCost(sel, p);
  $("calcTotal").textContent = fmtCost(total);
  $("calcResultLabel").textContent = `${sel.name} · 预计月成本`;

  const price = effectivePrice(sel, p.useIntro);
  const bits = [`输入 ${fmtP(price.input)}/M · 输出 ${fmtP(price.output)}/M`];
  if (p.batch) bits.push("Batch 5 折");
  if (p.cacheRate > 0) bits.push(`缓存命中 ${Math.round(p.cacheRate * 100)}%`);
  $("calcBreak").textContent = bits.join(" · ");

  const rows = D.claude.api.map(m => ({ m, cost: monthlyCost(m, p) }));
  const maxCost = Math.max(...rows.map(r => r.cost));
  $("calcBars").innerHTML = rows.map(r => `
    <div class="hbar-row ${r.m.id === sel.id ? "is-selected" : ""}" title="${r.m.name}">
      <span class="hbar-label">${r.m.name.replace("Claude ", "")}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${(r.cost / maxCost * 100).toFixed(1)}%"></div></div>
      <span class="hbar-val">${fmtCost(r.cost)}</span>
    </div>`).join("");

  const { web } = D.claude;
  const hint = $("calcHint");
  if (total > web.max5x && total <= web.max20x * 3) {
    hint.textContent = `提示：这个用量若主要发生在 Claude Code / 对话场景，Max 5x 订阅（${fmtP(web.max5x)}/月）可能比按 API 计费更划算。`;
  } else if (total > web.max20x * 3) {
    hint.textContent = "提示：月成本已远超订阅档位，建议重点优化缓存与 Batch，或联系 Anthropic 谈企业用量价。";
  } else hint.textContent = "";
}

function initCalc() {
  $("calcModel").innerHTML = D.claude.api.map(m =>
    `<option value="${m.id}" ${m.id === "sonnet-5" ? "selected" : ""}>${m.name}</option>`).join("");
  ["calcModel", "calcIn", "calcOut", "calcReq", "calcCache", "calcBatch", "calcIntro"]
    .forEach(id => $(id).addEventListener("input", renderCalc));
  renderCalc();
}

/* ================= 各国价格 ================= */

let currentPlan = "pro";
const PLAN_LABEL = { pro: "Pro", max5x: "Max 5x", max20x: "Max 20x" };

function renderRegionChart() {
  const key = currentPlan;
  const { web } = D.claude;
  const webRef = key === "pro" ? web.proAnnual : key === "max5x" ? web.max5x : web.max20x;
  const rows = D.claude.regions.filter(r => r[key] != null).sort((a, b) => a[key] - b[key]);
  $("regionChartTitle").textContent = `${PLAN_LABEL[key]} 各区月价（美元折算）`;

  if (!rows.length) {
    $("regionChart").innerHTML =
      `<p class="fine" style="margin:8px 0">该档位的各区 iOS 挂牌价由自动抓取管线核验后显示（不猜数）。网页直订价：${fmtP(webRef)}/月。</p>`;
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
      <td class="num">${r.pro != null ? fmtUSD(r.pro) : pending}</td>
      <td class="num">${r.local != null ? r.local + "/mo" : `<span class="muted">—</span>`}</td>
      <td class="num">${r.max5x != null ? fmtUSD(r.max5x) : pending}</td>
      <td class="num">${deltaCell}</td>
      <td>${r.tax}</td>
      <td><span class="risk risk-${r.risk === "中" ? "mid" : "low"}">${r.risk}</span>${r.riskNote ? `<div class="fine">${r.riskNote}</div>` : ""}</td>
      <td>${addr}</td>
    </tr>`;
  }).join("");
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

function initRegionTabs() {
  const planBtns = document.querySelectorAll(".seg-btn[data-plan]");
  planBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      planBtns.forEach(b => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      currentPlan = btn.dataset.plan;
      renderRegionChart();
    });
  });
  const storeBtns = document.querySelectorAll(".seg-btn[data-store]");
  storeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      storeBtns.forEach(b => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      const isPlay = btn.dataset.store === "play";
      $("viewAppstore").hidden = isPlay;
      $("viewPlay").hidden = !isPlay;
    });
  });
}

/* ================= 热力图块（相对美区，发散配色） ================= */

function renderHeatTiles() {
  const el = $("heatTiles");
  const usPro = D.claude.regions.find(r => r.cc === "us")?.pro;
  const rows = D.claude.regions.filter(r => r.pro != null);
  if (!rows.length || usPro == null) {
    el.innerHTML = `<p class="fine">热力图在 App Store 各区价格核验后显示（管线待跑）。</p>`;
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

/* ================= Top3 榜单 ================= */

function renderTop3() {
  const rows = D.claude.regions.filter(r => r.pro != null).sort((a, b) => a.pro - b.pro);
  const pendingLi = `<li class="fine">待管线核验后显示</li>`;
  const li = r => `<li><span class="t3-flag">${r.flag}</span><span class="t3-name">${r.name}</span><b>${fmtUSD(r.pro)}</b></li>`;
  $("top3Cheap").innerHTML = rows.length ? rows.slice(0, 3).map(li).join("") : pendingLi;
  $("top3Rich").innerHTML = rows.length ? rows.slice(-3).reverse().map(li).join("") : pendingLi;
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
    el.innerHTML = `<p class="fine">购买力对比需要「各区价格（Apple 管线）+ IMF 购买力换算率」两组数据核验后显示。</p>`;
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
      <span class="ppp-val">${fmtUSD(r.ppp, 0)} <i>+${Math.round((r.ppp / r.pro - 1) * 100)}%</i></span>
    </div>`;
  }).join("");
}

/* ================= 分享卡片（canvas 生成 PNG） ================= */

function initShare() {
  $("shareBtn").addEventListener("click", () => {
    const rows = D.claude.regions.filter(r => r.pro != null).sort((a, b) => a.pro - b.pro);
    const playRows = D.claude.regions.filter(r => r.play);
    const useAppstore = rows.length >= 3;
    if (!useAppstore && !playRows.length) { alert("价格数据核验后即可生成分享卡片"); return; }

    const W = 1080, H = 1080;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    const ink = "#0b0b0b", muted = "#898781", accent = "#b5542f", good = "#006300";
    x.fillStyle = "#f9f9f7"; x.fillRect(0, 0, W, H);
    x.fillStyle = accent; x.fillRect(0, 0, W, 14);
    x.fillStyle = ink; x.font = "700 54px system-ui, sans-serif";
    x.fillText("Claude 各国商店价格", 72, 140);
    x.fillStyle = muted; x.font = "400 30px system-ui, sans-serif";
    x.fillText(`数据版本 ${D.updatedAt} · 全部核验自官方商店页`, 72, 196);

    let y = 300;
    x.font = "650 36px system-ui, sans-serif";
    if (useAppstore) {
      x.fillStyle = ink; x.fillText("App Store · Pro 月价（美元折算）", 72, y); y += 30;
      const top = [...rows.slice(0, 3), ...rows.slice(-2).reverse()];
      top.forEach((r, i) => {
        y += 88;
        x.font = "400 40px system-ui, sans-serif"; x.fillStyle = ink;
        x.fillText(`${r.flag} ${r.name}`, 72, y);
        x.font = "700 40px system-ui, sans-serif";
        x.fillStyle = i < 3 ? good : accent;
        x.fillText(fmtUSD(r.pro), 760, y);
      });
    } else {
      x.fillStyle = ink; x.fillText("Google Play · 内购价区间（本币）", 72, y); y += 30;
      playRows.slice(0, 6).forEach(r => {
        y += 88;
        x.font = "400 38px system-ui, sans-serif"; x.fillStyle = ink;
        x.fillText(`${r.flag} ${r.name}`, 72, y);
        x.font = "650 32px system-ui, sans-serif"; x.fillStyle = accent;
        x.fillText(r.play, 420, y);
      });
    }

    y = 950;
    x.fillStyle = muted; x.font = "400 28px system-ui, sans-serif";
    x.fillText("网页直订通常更便宜：Pro 年付 $17/月 · Max 5x $100 · Max 20x $200", 72, y);
    x.fillStyle = ink; x.font = "650 30px system-ui, sans-serif";
    x.fillText("Claude 定价站 · 每个数字可追溯", 72, y + 56);

    const a = document.createElement("a");
    a.download = `claude-pricing-${D.updatedAt}.png`;
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

/* ================= GPT / Grok 行情 ================= */

function renderMarket() {
  // 跨家旗舰对比（输入/输出双系列）
  const cross = [
    ...D.claude.api.filter(m => ["fable-5", "opus-4-8", "sonnet-5"].includes(m.id))
      .map(m => ({ name: m.name.replace("Claude ", "Claude "), input: m.input, output: m.output })),
    ...D.openai.api.models.filter(m => ["gpt-5.6-sol", "gpt-5.6-terra"].includes(m.id))
      .map(m => ({ name: m.name, input: m.input, output: m.output })),
    ...D.xai.api.models.filter(m => m.id === "grok-4.5")
      .map(m => ({ name: m.name, input: m.input, output: m.output })),
  ];
  const maxV = Math.max(...cross.flatMap(r => [r.input, r.output])) * 1.08;
  $("crossChart").innerHTML = cross.map(r => `
    <div class="cross-row">
      <span class="cross-label">${r.name}</span>
      <div class="cross-bars">
        <div class="cross-track"><div class="cross-fill in" style="width:${(r.input / maxV * 100).toFixed(1)}%"></div><span class="cross-val">${fmtP(r.input)}</span></div>
        <div class="cross-track"><div class="cross-fill out" style="width:${(r.output / maxV * 100).toFixed(1)}%"></div><span class="cross-val">${fmtP(r.output)}</span></div>
      </div>
    </div>`).join("");

  // 两家卡片
  renderVendor("openai", "ChatGPT / OpenAI");
  renderVendor("xai", "Grok / xAI");
}

function renderVendor(key, label) {
  const v = D[key];
  $(key + "Subs").innerHTML = `
    <div class="vendor-block-head"><h4>订阅</h4>${vBadge(v.subs.verifiedAt, v.subs.source)}</div>
    <ul class="sub-list">
      ${v.subs.plans.map(p => `<li><span>${p.name}</span><b>${
        p.price != null ? fmtP(p.price) + `<i>${p.unit}</i>` : `<span class="vb vb-wait">待核验</span>`
      }</b><em>${p.note}</em></li>`).join("")}
    </ul>`;
  $(key + "Api").innerHTML = `
    <div class="vendor-block-head"><h4>API（$/百万 token）</h4>${vBadge(v.api.verifiedAt, v.api.source)}</div>
    <table class="cmp-table mini-table">
      <thead><tr><th>模型</th><th>输入</th><th>输出</th><th>缓存读</th></tr></thead>
      <tbody>${v.api.models.map(m => `
        <tr><td>${m.name}</td><td class="num">${fmtP(m.input)}</td><td class="num">${fmtP(m.output)}</td>
        <td class="num">${m.cached != null ? fmtP(m.cached) : "—"}</td></tr>`).join("")}
      </tbody>
    </table>
    <p class="fine">${v.api.notes || ""}</p>
    ${v.playUS ? `
    <div class="vendor-block-head"><h4>Google Play 美区内购区间</h4>${vBadge(v.playUS.verifiedAt, v.playUS.source)}</div>
    <p class="play-range">${v.playUS.range}<span class="fine-inline">最低档 ≈ 入门订阅月付，最高档为最贵 SKU</span></p>` : ""}`;
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
  renderChannels();
  renderApiTable();
  initCalc();
  renderRegionChart();
  renderRegionTable();
  renderHeatTiles();
  renderTop3();
  renderPlayTable();
  renderPPP();
  initRegionTabs();
  initShare();
  renderAddrChips();
  renderMarket();
  renderProvenance();
}

boot();
