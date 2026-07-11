# Claude 定价站

对标（并超越）opentherank.com 的 AI 定价信息站。核心差异化：**诚实口径 + 全部数据核验自官方来源、每日自动更新**。

- 私有仓库：https://github.com/xmbud8888-coder/claude-pricing-site
- 自动管线：GitHub Actions 每日 03:17 UTC（北京 11:17）自动运行，数据变更自动提交
- 手动触发：Actions → 「价格自动核验」→ Run workflow

## 页面（一产品一页，同对手站结构）

| 页面 | 产品 | 档位 | 数据状态 |
|---|---|---|---|
| index.html | Claude | Pro / Max 5x / Max 20x | Apple 17 区 + Play 17 区 + PPP ✅ |
| chatgpt.html | ChatGPT | Plus / Pro / Go | Apple 17 区 + Play 17 区 + PPP ✅ |
| grok.html | Grok | SuperGrok / Heavy | Apple 16 区 + Play 17 区 + PPP ✅ |

三页共用 app.js（`<body data-product>` 选产品）与 data/prices.json。
模板改动后运行 `node scripts/build-pages.mjs` 从 index.html 重新生成另外两页。

## 功能清单（对手站功能全量对齐 + 超越）

| 功能 | 状态 | 说明 |
|---|---|---|
| 各国 App Store 价格（Pro / Max 5x / **Max 20x** 三档） | ✅ 真数据 | 管线直抓 Apple 官方商店页，17/18 区（韩区 Apple 依当地法规不公示内购价） |
| **Google Play 各国价格** | ✅ 真数据 | 17/18 区内购区间（阿根廷区 Play 不公示），对手站没有这个 |
| 价格热力图（相对美区） | ✅ | 发散配色，蓝=便宜 红=贵 |
| 最便宜/最贵 Top3 榜单 | ✅ | |
| 定价 vs 购买力（PPP 哑铃图） | ✅ 真数据 | IMF DataMapper API 官方 PPPEX，管线按币种正确折算 |
| 风险标注 + 各区账单地址生成器链接 | ✅ | randaddress 16 区（丹麦/埃及无对应页，不乱链） |
| 分享价格卡片（PNG 生成下载） | ✅ | 纯 canvas，无依赖 |
| 渠道价差（网页 vs iOS，含 Max 20x） | ✅ 真数据 | 美区 iOS：Pro $20 / 年付 $214.99 / Max 5x $124.99 / Max 20x $249.99 |
| API 定价 + 成本计算器 + ChatGPT/Grok 行情 | ✅ | |
| 数据来源账本（每组数据可追溯） | ✅ | 对手站完全没有 |

```
claude-pricing-site/
├── index.html                      # 页面结构（不含任何价格数字）
├── style.css                       # 样式（浅色/深色自适应）
├── app.js                          # 渲染逻辑（全部从 data/prices.json 读数）
├── data/
│   ├── prices.json                 # ★ 唯一价格数据源（订阅/API/各区/三家行情）
│   ├── watch.json                  # 定价页指纹（管线生成，用于变更检测）
│   └── fetch-report.json           # 每次抓取的报告（管线生成）
├── scripts/
│   └── fetch-prices.mjs            # 抓价 + 变更检测脚本（Node ≥18，零依赖）
└── .github/workflows/
    └── refresh-prices.yml          # GitHub Actions：每日自动运行管线
```

## 本地预览

```sh
cd claude-pricing-site
python3 -m http.server 8899
# 打开 http://localhost:8899   （必须走 http，直接双击 index.html 会加载不到数据）
```

## 价格数据管线（核心机制）

**页面不硬编码价格。** 所有数字来自 `data/prices.json`，站点加载时读取渲染。

`scripts/fetch-prices.mjs` 每日在 GitHub Actions（美国节点）运行：

1. **App Store 抓取**：抓 Claude（18 区）/ ChatGPT / Grok 的商店页，解析内购价。
   高置信匹配（如美区 Claude Pro/Max）直接回填 `prices.json`——包括目前缺的
   Max 20x iOS 价，抓到即自动上线。
2. **官方定价页变更检测**：对 claude.com/pricing、developers.openai.com、docs.x.ai
   提取「价格指纹」（页面上全部 $ 金额 + 型号名），与上次对比；有变化 → exit 2 →
   CI 自动开 issue 提醒复核。
3. 输出 `data/fetch-report.json` 供人工或 agent 复核。

> ⚠️ 管线必须从非中国大陆网络运行：apps.apple.com 会按 IP 重定向到 CN 商店，
> openai.com / x.ai / grok.com 有 bot 防护（403）。GitHub Actions runner 天然满足。

页面上的核验状态徽章由 `prices.json` 中的 `verifiedAt` 字段驱动：
- 绿色「已核验 + 日期」= 该组数据当天从官方页面确认过
- 灰色「待管线核验」= 官网有 bot 防护，数字为通行价，等管线首跑确认

## 数据可信规则（硬约束）

**价格必须核验自官方来源才展示。** 实现机制：

- `prices.json` 里每组数据都挂在 `provenance` 账本上（status: verified / pending + 来源 URL + 核验日期），站点的「数据来源账本」板块直接渲染这份账本
- **未核验的字段一律为 `null`**，UI 渲染成「待核验」徽章，绝不显示猜测数字
- 第三方转述数据（竞品站的 App Store 价、训练知识里的订阅价）存放在
  `data/unverified-reference.json`——**站点不加载它**，只供管线首跑时交叉比对合理性
- 管线从官方页面抓到实价 → 回填 `prices.json` → 账本状态自动转 verified

## 已核验事实（全部有官方原文背书，2026-07-12）

- **Claude 订阅**（claude.com/pricing + support.claude.com 官方帮助）：Pro $20 月付 /
  $17 年付折合；Max 5x $100；**Max 20x $200**；Team 标准 $25/$20、高级 $125/$100
- **Claude API**（platform.claude.com 官方模型文档，当日原文核验）：Fable 5 $10/$50 ·
  Opus 4.8/4.7/4.6 $5/$25 · Sonnet 5 $3/$15（限时 $2/$10 至 2026-08-31）·
  Sonnet 4.6 $3/$15 · Haiku 4.5 $1/$5；缓存读 0.1×、写 1.25×(5m)/2×(1h)；Batch 5 折
- **OpenAI API**（developers.openai.com）：GPT-5.6 Sol $5/$30 · Terra $2.50/$15 ·
  Luna $1/$6 · GPT-5.5 Pro $30/$180 · 5.4 Mini $0.75/$4.50 · 5.4 Nano $0.20/$1.25；
  Batch/Flex 5 折
- **xAI API**（docs.x.ai）：Grok 4.5 $2/$6 · Grok 4.3 $1.25/$2.50 · Grok Build 0.1 $1/$2

## 待管线核验（当前显示"待核验"，不显示数字）

- ChatGPT / Grok 订阅价（官网 bot 防护）
- App Store 全部内购价：美区 iOS 各档、18 区价格、Max 20x iOS 价
  （apps.apple.com 对大陆 IP 地区重定向，需海外节点抓取；管线已支持逐区回填
  本币价 + 公开汇率折算美元）

## 维护日历

- **每天**：CI 自动跑管线；有 issue 就去复核
- **2026-08-31**：Sonnet 5 限时价截止 → 删 `prices.json` 里 sonnet-5 的 `intro`
  字段，删 index.html 的限时横幅
- **手动改价**：只改 `data/prices.json`，改完更新 `updatedAt`

## 部署

- **Cloudflare Pages（推荐）**：连 GitHub 仓库，构建命令留空，输出目录 `/`
- **Vercel**：`npx vercel --prod`
- 注意：GitHub Actions 管线提交数据后，托管平台会自动重新部署（静态文件直出）

## Roadmap（未做）

- [ ] 管线首跑后确认 Apple IAP 解析器对当前页面结构的匹配度（`fetch-report.json`）
- [ ] ChatGPT / Grok 订阅价的抓取源（官网 403，可改抓 App Store 内购价代替）
- [ ] 英文版（/en/）与 hreflang
- [ ] 价格变更时间线页（changelog，管线 issue 可直接作为素材）
- [ ] OG 分享图
- [ ] 域名 + 统计
