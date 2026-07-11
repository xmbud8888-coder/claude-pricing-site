#!/usr/bin/env node
/**
 * 以 index.html（Claude 页）为模板，生成 chatgpt.html / grok.html。
 * 模板改动后运行：node scripts/build-pages.mjs
 */
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const PRODUCTS = [
  {
    file: "chatgpt.html", key: "chatgpt", label: "ChatGPT", dev: "OpenAI",
    site: "https://chatgpt.com/", icon: "◎", store: "ChatGPT",
    title: "2026 各国 ChatGPT 价格对比 | ChatGPT 哪个国家最便宜",
    desc: "比较 ChatGPT 订阅（Plus / Pro / Go）在全球 App Store 与 Google Play 各区域的价格：最便宜/最贵国家排行、完整价格表、购买力对比、换区订阅指南。数据每日自动抓取官方商店页核验。",
  },
  {
    file: "grok.html", key: "grok", label: "Grok", dev: "xAI",
    site: "https://grok.com/", icon: "𝕏", store: "Grok",
    title: "2026 各国 Grok 价格对比 | SuperGrok 哪个国家最便宜",
    desc: "比较 Grok 订阅（SuperGrok / Heavy）在全球 App Store 与 Google Play 各区域的价格：最便宜/最贵国家排行、完整价格表、购买力对比、换区订阅指南。数据每日自动抓取官方商店页核验。",
  },
];

const tpl = await readFile(path.join(ROOT, "index.html"), "utf-8");

for (const p of PRODUCTS) {
  let html = tpl;
  html = html.replace('data-product="claude"', `data-product="${p.key}"`);
  html = html.replace(/<title>.*?<\/title>/s, `<title>${p.title}</title>`);
  html = html.replace(/(<meta name="description" content=").*?(">)/s, `$1${p.desc}$2`);
  html = html.replace('<div class="app-icon">✳</div>', `<div class="app-icon">${p.icon}</div>`);
  html = html.replace(
    /<h1><a href="https:\/\/claude\.ai\/" rel="noopener" target="_blank">Claude 全球定价<\/a><\/h1>/,
    `<h1><a href="${p.site}" rel="noopener" target="_blank">${p.label} 全球定价</a></h1>`);
  html = html.replace("<p class=\"app-dev\">开发者：Anthropic</p>", `<p class="app-dev">开发者：${p.dev}</p>`);
  // 产品名替换（板块标题 / FAQ 标题等文案里的 Claude → 产品名）
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
  html = html.replace(/欧洲各国 20–25% 的增值税直接计入挂牌价，叠加汇率因素，使英国、德国、法国、丹麦等地明显高于美区基准。/g,
                      "欧洲各国 20–25% 的增值税直接计入挂牌价，叠加汇率因素，通常使欧洲地区高于美区基准。");
  html = html.replace(/Claude 是 Anthropic 的商标。/g, `${p.label} 是 ${p.dev} 的商标。`);
  html = html.replace(/与 Anthropic 无关联/g, `与 ${p.dev} 无关联`);
  // 产品导航 active 态
  html = html.replace('<a class="prod-tab active" href="index.html">Claude</a>', '<a class="prod-tab" href="index.html">Claude</a>');
  html = html.replace(`<a class="prod-tab" href="${p.file}">${p.label}</a>`,
                      `<a class="prod-tab active" href="${p.file}">${p.label}</a>`);
  await writeFile(path.join(ROOT, p.file), html);
  console.log("built", p.file);
}
