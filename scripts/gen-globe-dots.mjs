#!/usr/bin/env node
/**
 * 从 Natural Earth land-110m TopoJSON（公有领域）生成地球点阵：
 * 对经纬网格采样，落在陆地上的点写入 assets/globe-dots.json（[lat, lon] 压缩数组）。
 * 用法：node scripts/gen-globe-dots.mjs <land-110m.json 路径>
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2];
if (!src) { console.error("用法：node scripts/gen-globe-dots.mjs <land-110m.json>"); process.exit(1); }

const topo = JSON.parse(await readFile(src, "utf-8"));
const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;

// 解码 TopoJSON arcs（增量编码 → 经纬度坐标）
const arcs = topo.arcs.map(arc => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => {
    x += dx; y += dy;
    return [x * sx + tx, y * sy + ty];   // [lon, lat]
  });
});

// 展开几何体为环（ring = 首尾相接的经纬点列表）
function ringFromArcIndices(indices) {
  const pts = [];
  for (const idx of indices) {
    let a = idx >= 0 ? arcs[idx] : [...arcs[~idx]].reverse();
    if (pts.length) a = a.slice(1);   // 相邻 arc 首点与上一段尾点重复
    pts.push(...a);
  }
  return pts;
}
const rings = [];
for (const geom of topo.objects.land.geometries) {
  const polys = geom.type === "Polygon" ? [geom.arcs] : geom.arcs;
  for (const poly of polys) for (const ring of poly) rings.push(ringFromArcIndices(ring));
}

// 线段索引（按经度分桶，加速射线求交）
const BUCKETS = 360;
const buckets = Array.from({ length: BUCKETS }, () => []);
for (const ring of rings) {
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    const lo = Math.floor(Math.min(x1, x2) + 180), hi = Math.floor(Math.max(x1, x2) + 180);
    if (hi - lo > 180) continue;   // 跨反经线的缝合段忽略（110m 数据不影响陆地判定）
    for (let b = Math.max(0, lo); b <= Math.min(BUCKETS - 1, hi); b++) buckets[b].push([x1, y1, x2, y2]);
  }
}
// 偶奇规则：向北射线穿越次数为奇 → 在陆地（洞如里海自动扣除）
function onLand(lon, lat) {
  let crossings = 0;
  for (const [x1, y1, x2, y2] of buckets[Math.floor(lon + 180)]) {
    if ((x1 > lon) === (x2 > lon)) continue;
    const yCross = y1 + (lon - x1) / (x2 - x1) * (y2 - y1);
    if (yCross > lat) crossings++;
  }
  return crossings % 2 === 1;
}

// 网格采样：纬向等间距，经向按 cos(lat) 拉开保持球面密度均匀
const STEP = 1.6;
const dots = [];
for (let lat = -58; lat <= 84; lat += STEP) {
  const lonStep = STEP / Math.max(0.25, Math.cos(lat * Math.PI / 180));
  for (let lon = -180; lon < 180; lon += lonStep) {
    if (onLand(lon, lat)) dots.push(+lat.toFixed(1), +lon.toFixed(1));
  }
}

await mkdir(path.join(ROOT, "assets"), { recursive: true });
await writeFile(path.join(ROOT, "assets", "globe-dots.json"), JSON.stringify(dots));
console.log(`生成 ${dots.length / 2} 个陆地点 → assets/globe-dots.json (${(JSON.stringify(dots).length / 1024).toFixed(0)}KB)`);
