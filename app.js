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

/* ================= 产品导航（数据驱动） ================= */

function renderProdNav() {
  const nav = $("prodNav");
  if (!nav) return;
  nav.innerHTML = Object.entries(D.products).map(([key, p]) => {
    const href = key === "claude" ? "index.html" : `${key}.html`;
    return `<a class="prod-tab ${key === PRODUCT ? "active" : ""}" href="${href}">${p.label}</a>`;
  }).join("");
}

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
      globeSetTier();      // 地球光柱随档位平滑变形
      renderHeatTiles();   // 平面热力砖同步档位
    });
  });
}

/* ================= 3D 地球价格光柱（手写正交投影，零依赖） ================= */

const heatCls = (v, us) => {
  if (v == null || us == null) return "heat-none";
  const d = (v - us) / us * 100;
  return d <= -5 ? "heat-cheap" : d < 5 ? "heat-base" : d < 20 ? "heat-warm" : "heat-hot";
};
// 深色舞台上的发散语义色（蓝=便宜 / 灰=基准 / 橙=贵 / 红=更贵）
const GLOBE_COLORS = {
  "heat-cheap": { line: "#4da3ff", glow: "rgba(77,163,255,.45)" },
  "heat-base":  { line: "#b7bcc4", glow: "rgba(183,188,196,.30)" },
  "heat-warm":  { line: "#ffb340", glow: "rgba(255,179,64,.40)" },
  "heat-hot":   { line: "#ff5f57", glow: "rgba(255,95,87,.45)" },
  "heat-none":  { line: "#5a5f68", glow: "rgba(90,95,104,.25)" },
};

const globe = {
  dots: null,
  markers: [],
  yaw: 4.2, pitch: 0.42,
  vyaw: 0, dragging: false, hoverCC: null,
  raf: 0, visible: false, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  _buckets: [[], [], [], []],   // 帧间复用，避免每帧分配
  _proj: [],
};

async function initGlobe() {
  const canvas = $("globeCanvas");
  if (!canvas) return;
  try {
    const res = await fetch("assets/globe-dots.json?v=g2");
    const flat = await res.json();          // [lat, lon, ...]
    const n = flat.length / 2;
    globe.dots = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const la = flat[i * 2] * Math.PI / 180, lo = flat[i * 2 + 1] * Math.PI / 180;
      globe.dots[i * 3]     = Math.cos(la) * Math.sin(lo);
      globe.dots[i * 3 + 1] = Math.sin(la);
      globe.dots[i * 3 + 2] = Math.cos(la) * Math.cos(lo);
    }
  } catch { /* 点阵加载失败则只画光柱 */ }

  buildGlobeMarkers();
  bindGlobeInput(canvas);

  // 仅在可见时渲染：不可见 → 循环自停（tickGlobe 顶部清零 raf），可见 → 重启
  new IntersectionObserver(es => {
    globe.visible = es[0].isIntersecting;
    if (globe.visible && !globe.raf) tickGlobe();
  }).observe(canvas);
  // 静态星空（初始化一次，帧内零分配）
  globe.stars = Array.from({ length: 150 }, () => ({
    nx: Math.random(), ny: Math.random(),
    r: Math.random() * 1.1 + 0.4, a: Math.random() * 0.35 + 0.12,
  }));
}

function buildGlobeMarkers() {
  const key = currentTier || P.baseTier;
  const us = R.find(r => r.cc === "us")?.[key];
  const vals = R.map(r => r[key]).filter(v => v != null);
  const max = vals.length ? Math.max(...vals) : 1;
  const prev = Object.fromEntries(globe.markers.map(m => [m.cc, m.h]));
  globe.markers = R.filter(r => r.lat != null).map(r => {
    const la = r.lat * Math.PI / 180, lo = r.lon * Math.PI / 180;
    const v = r[key];
    return {
      cc: r.cc, name: r.name, flag: r.flag, price: v,
      vec: [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)],
      h: prev[r.cc] ?? 0,
      hTarget: v != null ? 0.06 + (v / max) * 0.34 : 0.02,
      color: GLOBE_COLORS[heatCls(v, us)],
      deltaTxt: (v != null && us) ? (v === us ? "基准" : (v > us ? "+" : "") + Math.round((v - us) / us * 100) + "% vs 美区") : "待核验",
    };
  });
  const withV = globe.markers.filter(m => m.price != null).sort((a, b) => a.price - b.price);
  globe.markers.forEach(m => m.tag = null);
  if (withV.length > 1) { withV[0].tag = "min"; withV[withV.length - 1].tag = "max"; }
}
function globeSetTier() { buildGlobeMarkers(); }

function rotXY(v, cy, sy, cp, sp) {   // 传入预计算的 cos/sin，帧内零重复三角函数
  const x1 = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy;
  return [x1, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp];
}

function tickGlobe() {
  if (!globe.visible) { globe.raf = 0; return; }   // 循环真正停止，可被重启
  globe.raf = requestAnimationFrame(tickGlobe);
  const canvas = $("globeCanvas"), stage = $("globeStage");
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = stage.clientWidth, H = stage.clientHeight;
  if (!W || !H) return;                             // 折叠/切换视图的空帧守卫
  const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  const x = canvas.getContext("2d");
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, W, H);

  if (!globe.dragging) {
    globe.yaw += globe.vyaw;
    globe.vyaw *= 0.94;
    if (!globe.reduced && !globe.hoverCC && Math.abs(globe.vyaw) < 0.0004) globe.yaw += 0.0011;
  }

  const cx = W / 2, cyc = H / 2 + 14;
  const Rpx = Math.min(W * 0.46, H / 2 - Math.max(52, H * 0.11));
  if (Rpx <= 0) return;
  // 本帧三角函数只算一次
  const cy0 = Math.cos(globe.yaw), sy0 = Math.sin(globe.yaw);
  const cp0 = Math.cos(globe.pitch), sp0 = Math.sin(globe.pitch);

  // 星空（静态，帧内零分配）
  if (globe.stars) {
    for (const s of globe.stars) {
      x.globalAlpha = s.a;
      x.fillStyle = "#cfe0ff";
      x.fillRect(s.nx * W, s.ny * H, s.r, s.r);
    }
    x.globalAlpha = 1;
  }
  // 球体底盘 + 大气边缘
  const disc = x.createRadialGradient(cx - Rpx * .35, cyc - Rpx * .4, Rpx * .1, cx, cyc, Rpx);
  disc.addColorStop(0, "rgba(56,74,110,.38)");
  disc.addColorStop(.75, "rgba(24,34,56,.22)");
  disc.addColorStop(1, "rgba(10,16,30,.05)");
  x.fillStyle = disc;
  x.beginPath(); x.arc(cx, cyc, Rpx, 0, 7); x.fill();
  const halo = x.createRadialGradient(cx, cyc, Rpx * .92, cx, cyc, Rpx * 1.10);
  halo.addColorStop(0, "rgba(0,0,0,0)");
  halo.addColorStop(.55, "rgba(88,138,224,.16)");
  halo.addColorStop(.8, "rgba(88,138,224,.05)");
  halo.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = halo;
  x.beginPath(); x.arc(cx, cyc, Rpx * 1.10, 0, 7); x.fill();
  x.strokeStyle = "rgba(120,160,235,.32)"; x.lineWidth = 1.2;
  x.beginPath(); x.arc(cx, cyc, Rpx + .5, 0, 7); x.stroke();

  // 陆地点阵：内联标量旋转（零分配），4 桶批量绘制
  if (globe.dots) {
    const bks = globe._buckets;
    for (let b = 0; b < 4; b++) bks[b].length = 0;
    const d = globe.dots;
    for (let i = 0; i < d.length; i += 3) {
      const vx = d[i], vy = d[i + 1], vz = d[i + 2];
      const x1 = vx * cy0 + vz * sy0, z1 = -vx * sy0 + vz * cy0;
      const y2 = vy * cp0 - z1 * sp0, z2 = vy * sp0 + z1 * cp0;
      if (z2 < 0.03) continue;
      bks[Math.min(3, z2 * 4 | 0)].push(cx + x1 * Rpx, cyc - y2 * Rpx);
    }
    const alphas = [.16, .28, .44, .62];
    const ds = Math.max(1.6, Rpx * 0.0062), hd = ds / 2;
    for (let b = 0; b < 4; b++) {
      x.fillStyle = `rgba(150,180,228,${alphas[b]})`;
      x.beginPath();
      const pts = bks[b];
      for (let i = 0; i < pts.length; i += 2) x.rect(pts[i] - hd, pts[i + 1] - hd, ds, ds);
      x.fill();
    }
  }

  // 价格光柱（先远后近；18 根，量小保留渐变美术）
  const proj = globe._proj;
  proj.length = 0;
  for (const m of globe.markers) {
    m.h += (m.hTarget - m.h) * 0.10;
    const b = rotXY(m.vec, cy0, sy0, cp0, sp0);
    if (b[2] < -0.05) continue;
    const t = 1 + m.h;
    proj.push({ m, z: b[2],
      bx: cx + b[0] * Rpx, by: cyc - b[1] * Rpx,
      tx: cx + b[0] * Rpx * t, ty: cyc - b[1] * Rpx * t });
  }
  proj.sort((a, b) => a.z - b.z);
  for (const p of proj) {
    const { m } = p, edge = Math.max(0.25, Math.min(1, p.z * 1.6));
    const hovered = globe.hoverCC === m.cc;
    const g = x.createLinearGradient(p.bx, p.by, p.tx, p.ty);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, m.color.line);
    x.strokeStyle = g;
    x.globalAlpha = edge * (hovered ? 1 : .9);
    x.lineWidth = hovered ? 3 : 2;
    x.lineCap = "round";
    x.beginPath(); x.moveTo(p.bx, p.by); x.lineTo(p.tx, p.ty); x.stroke();
    const glow = x.createRadialGradient(p.tx, p.ty, 0, p.tx, p.ty, hovered ? 13 : 9);
    glow.addColorStop(0, m.color.glow); glow.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = glow;
    x.beginPath(); x.arc(p.tx, p.ty, hovered ? 13 : 9, 0, 7); x.fill();
    x.fillStyle = m.color.line;
    x.beginPath(); x.arc(p.tx, p.ty, hovered ? 3.2 : 2.4, 0, 7); x.fill();
    x.globalAlpha = 1;
  }
  // 极值/悬停标签
  x.textAlign = "center"; x.textBaseline = "bottom";
  for (const p of proj) {
    const { m } = p;
    if (!(m.tag || globe.hoverCC === m.cc) || p.z < 0.15 || m.price == null) continue;
    x.font = "600 13px system-ui, -apple-system, sans-serif";
    x.fillStyle = "rgba(245,245,247,.92)";
    x.shadowColor = "rgba(0,0,0,.8)"; x.shadowBlur = 6;
    x.fillText(`${m.flag} ${fmtUSD(m.price, 0)}`, p.tx, p.ty - 12);
    x.shadowBlur = 0;
  }
}

function globePickAt(mx, my) {
  let best = null, bestD = 20;
  for (const p of globe._proj) {
    const d = Math.hypot(p.tx - mx, p.ty - my);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function globeShowTip(p, stage, tip) {
  const W = stage.clientWidth;
  tip.hidden = false;
  tip.classList.toggle("below", p.ty < 76);                       // 球顶附近翻到下方，避免被裁
  tip.style.left = Math.max(78, Math.min(W - 78, p.tx)) + "px";   // 水平钳制在舞台内
  tip.style.top = p.ty + "px";
  tip.innerHTML = p.m.price != null
    ? `${p.m.flag} ${p.m.name} <b>${fmtUSD(p.m.price)}</b><br><span class="gt-delta">${p.m.deltaTxt}</span>`
    : `${p.m.flag} ${p.m.name}<br><span class="gt-delta">待核验</span>`;
}

function bindGlobeInput(canvas) {
  const stage = $("globeStage"), tip = $("globeTip");
  let downX = 0, downY = 0, lastX = 0, lastY = 0, moved = false, downAt = 0;
  stage.addEventListener("pointerdown", e => {
    downX = lastX = e.clientX; downY = lastY = e.clientY;
    moved = false; downAt = Date.now();
    globe.vyaw = 0;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", e => {
    const rect = stage.getBoundingClientRect();
    if (downAt) {
      // 超过 6px 才进入拖拽态（保住移动端 tap 拾取）
      if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > 6) {
        moved = true; globe.dragging = true;
      }
      if (globe.dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        globe.yaw += dx * 0.005; globe.vyaw = dx * 0.0009;
        globe.pitch = Math.max(-0.9, Math.min(0.9, globe.pitch + dy * 0.004));
        lastX = e.clientX; lastY = e.clientY;
        return;
      }
    }
    if (e.pointerType === "touch") return;   // 触摸的拾取走 tap（pointerup）
    // 鼠标悬停拾取
    const best = globePickAt(e.clientX - rect.left, e.clientY - rect.top);
    globe.hoverCC = best?.m.cc || null;
    stage.style.cursor = best ? "pointer" : "grab";
    if (best) globeShowTip(best, stage, tip); else tip.hidden = true;
  });
  stage.addEventListener("pointerup", e => {
    const wasTap = !moved && Date.now() - downAt < 500;
    globe.dragging = false; downAt = 0;
    if (wasTap && e.pointerType === "touch") {
      const rect = stage.getBoundingClientRect();
      const best = globePickAt(e.clientX - rect.left, e.clientY - rect.top);
      globe.hoverCC = best?.m.cc || null;
      if (best) globeShowTip(best, stage, tip); else tip.hidden = true;
    }
  });
  stage.addEventListener("pointercancel", () => { globe.dragging = false; downAt = 0; });
  stage.addEventListener("pointerleave", e => {
    globe.dragging = false; downAt = 0;
    if (e.pointerType !== "touch") { globe.hoverCC = null; tip.hidden = true; }
  });
}

/* ================= 价格热力图 ================= */

function renderHeatTiles() {
  const el = $("heatTiles");
  const key = currentTier || P.baseTier;
  const us = R.find(r => r.cc === "us")?.[key];
  const rows = R.filter(r => r[key] != null);
  if (!rows.length || us == null) {
    el.innerHTML = `<p class="fine">各区价格由管线核验后显示（每日自动运行）。</p>`;
    return;
  }
  el.innerHTML = [...rows].sort((a, b) => a[key] - b[key]).map(r => {
    const v = r[key];
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
  renderProdNav();
  renderHero();
  renderTierTabs();
  initGlobe();
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
