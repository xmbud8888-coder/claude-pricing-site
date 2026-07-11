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
    site: "https://chatgpt.com/", icon: "<svg fill=\"#000\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 20 20\"><path d=\"M11.248 18.25q-.825 0-1.568-.314a4.3 4.3 0 0 1-1.32-.874 4 4 0 0 1-1.304.214 4 4 0 0 1-2.046-.544 4.27 4.27 0 0 1-1.518-1.485 4 4 0 0 1-.56-2.095q0-.48.131-1.04A4.4 4.4 0 0 1 2.04 10.71a4.07 4.07 0 0 1 .017-3.4 4.2 4.2 0 0 1 1.056-1.418 3.8 3.8 0 0 1 1.6-.842 3.9 3.9 0 0 1 .76-1.683q.593-.759 1.451-1.188a4.04 4.04 0 0 1 1.832-.429q.825 0 1.567.313.742.314 1.32.875a4 4 0 0 1 1.304-.215q1.106 0 2.046.545a4.14 4.14 0 0 1 1.501 1.485q.578.941.578 2.095 0 .48-.132 1.04.66.61 1.023 1.419.363.792.363 1.666 0 .892-.38 1.717a4.3 4.3 0 0 1-1.072 1.435 3.8 3.8 0 0 1-1.584.825 3.8 3.8 0 0 1-.775 1.683 4.06 4.06 0 0 1-1.436 1.188 4.04 4.04 0 0 1-1.832.429m-4.076-2.062q.825 0 1.435-.347l3.103-1.782a.36.36 0 0 0 .164-.313v-1.42L7.881 14.62a.67.67 0 0 1-.726 0l-3.118-1.798a.5.5 0 0 1-.017.115v.198q0 .841.396 1.551.413.693 1.139 1.089a3.2 3.2 0 0 0 1.617.412m.165-2.69a.4.4 0 0 0 .181.05q.083 0 .165-.05l1.238-.71-3.977-2.31a.7.7 0 0 1-.363-.643v-3.58q-.825.362-1.32 1.122a2.9 2.9 0 0 0-.495 1.65q0 .809.413 1.55.412.743 1.072 1.123zm3.91 3.663q.875 0 1.585-.396a2.96 2.96 0 0 0 1.534-2.64v-3.564a.32.32 0 0 0-.165-.297l-1.254-.726v4.604a.7.7 0 0 1-.363.643l-3.119 1.799a3 3 0 0 0 1.783.577m.627-6.039V8.878L10.01 7.822 8.129 8.878v2.244l1.881 1.056zM7.057 5.859a.7.7 0 0 1 .363-.644l3.119-1.798a3 3 0 0 0-1.782-.578q-.874 0-1.584.396A2.96 2.96 0 0 0 6.05 4.324a3.07 3.07 0 0 0-.396 1.551v3.547q0 .199.165.314l1.237.726zm8.383 7.887q.825-.364 1.303-1.123.495-.758.495-1.65a3.15 3.15 0 0 0-.412-1.55q-.413-.743-1.073-1.123l-3.086-1.782q-.099-.065-.181-.049a.3.3 0 0 0-.165.05l-1.238.692 3.993 2.327a.6.6 0 0 1 .264.264.64.64 0 0 1 .1.363zm-3.317-8.382a.63.63 0 0 1 .726 0l3.135 1.831v-.297q0-.792-.396-1.501a2.86 2.86 0 0 0-1.105-1.155q-.71-.43-1.65-.43-.825 0-1.436.347L8.294 5.941a.36.36 0 0 0-.165.314v1.418z\"/></svg>", store: "ChatGPT",
    title: "2026 各国 ChatGPT 价格对比 | ChatGPT 哪个国家最便宜",
    desc: "比较 ChatGPT 订阅（Plus / Pro / Go）在全球 App Store 与 Google Play 各区域的价格：最便宜/最贵国家排行、完整价格表、购买力对比、换区订阅指南。数据每日自动抓取官方商店页核验。",
  },
  {
    file: "grok.html", key: "grok", label: "Grok", dev: "xAI",
    site: "https://grok.com/", icon: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 163.53 163.53\"><rect width=\"163.53\" height=\"163.53\" fill=\"#0a0a0a\"/><polygon points=\"105.02 34.51 38.72 129.19 58.68 129.19 124.98 34.51 105.02 34.51\" fill=\"#fff\"/></svg>", iconFull: true, store: "Grok",
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
  html = html.replace(/<div class="app-icon[^"]*">[\s\S]*?<\/div>\n/, `<div class="app-icon${p.iconFull ? " icon-full" : ""}">${p.icon}</div>\n`);
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
