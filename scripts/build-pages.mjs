#!/usr/bin/env node
/**
 * 以 index.html（Claude 页）为模板，为 data/prices.json 中的所有其他产品生成页面。
 * 图标：assets/icons/{key}.svg 存在则内联官方 logo，否则生成字母图标。
 * 模板或产品清单改动后运行：node scripts/build-pages.mjs
 */
import { readFile, writeFile, access } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const prices = JSON.parse(await readFile(path.join(ROOT, "data", "prices.json"), "utf-8"));
const tpl = await readFile(path.join(ROOT, "index.html"), "utf-8");

async function iconFor(key, label) {
  const file = path.join(ROOT, "assets", "icons", `${key}.svg`);
  try {
    await access(file);
    const svg = (await readFile(file, "utf-8")).trim();
    return { svg, full: svg.includes('data-full="1"') };
  } catch {
    // 字母图标（Apple 中性风格：墨色圆角块 + 白色首字母）
    const letter = label.replace(/[^A-Za-z0-9一-鿿]/g, "").slice(0, 1).toUpperCase() || "A";
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1d1d1f"/><text x="32" y="43" font-family="system-ui,sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text></svg>`,
      full: true,
    };
  }
}

for (const [key, p] of Object.entries(prices.products)) {
  if (key === "claude") continue;   // index.html 即 Claude 母版
  const tierNames = p.tiers.map(t => t.label).join(" / ");
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
  html = html.replace('<p class="app-dev">开发者：Anthropic</p>', `<p class="app-dev">开发者：${p.developer}</p>`);
  // 模板文案中的产品名批量替换
  html = html.replace(/Claude 全球价格地图/g, `${p.label} 全球价格地图`);
  html = html.replace(/Claude 最便宜的国家/g, `${p.label} 最便宜的国家`);
  html = html.replace(/Claude 最贵的国家/g, `${p.label} 最贵的国家`);
  html = html.replace(/Claude 定价 vs 本地购买力/g, `${p.label} 定价 vs 本地购买力`);
  html = html.replace(/Claude 订阅定价 FAQ/g, `${p.label} 订阅定价 FAQ`);
  html = html.replace(/哪个国家的 Claude 订阅最便宜/g, `哪个国家的 ${p.label} 订阅最便宜`);
  html = html.replace(/为什么 Claude 在英国和欧洲这么贵/g, `为什么 ${p.label} 在英国和欧洲这么贵`);
  html = html.replace(/Claude 在 Google Play、网页版和 App Store 之间有价格差异吗/g,
                      `${p.label} 在 Google Play、网页版和 App Store 之间有价格差异吗`);
  html = html.replace(/下载 Claude，在 App 内购买订阅/g, `下载 ${p.label}，在 App 内购买订阅`);
  html = html.replace(/订阅网页价核验自 claude\.com\/pricing 与官方帮助中心；/g, "");
  html = html.replace(/订阅网页价来自 claude\.com\/pricing；/g, "");
  html = html.replace(/Claude 是 Anthropic 的商标。/g, `${p.label} 是 ${p.developer} 的商标。`);
  html = html.replace(/与 Anthropic 无关联/g, `与 ${p.developer} 无关联`);

  await writeFile(path.join(ROOT, `${key}.html`), html);
  console.log("built", `${key}.html`);
}
