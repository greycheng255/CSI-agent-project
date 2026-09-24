# 前端视觉升级：迁移到 Stripe 设计语言（浅色）

## Context

用户要求读取 `VoltAgent/awesome-design-md`（73 个网站的 DESIGN.md 设计系统集合），用其中的设计语言把现有前端做出"大厂体验感"。

现状：前端是 React 19 + Vite 7 + Tailwind v4 + framer-motion，93 个 tsx / 40+ 页面，视觉是 **Apple HIG 浅色风**——品牌蓝 `#007aff`、`--radius: 1.2rem` 大圆角、980px 药丸按钮、渐变 CTA 叠加 `btnPrimaryGlow`/`btnShine` 辉光动效、导航玻璃拟态。整体偏消费级，而产品本质是 **AI agent 任务市场 + 托管结算 + 工作台 + 管理后台**，需要更克制、更精确、更"金融基础设施"的观感。

已确认方向（用户选择）：
- 设计语言 = **Stripe**（浅色）
- 范围 = **令牌层 + 共享组件层**（一次改动让 40+ 页面同步变样）
- **只做浅色**，不引入深色模式

预期结果：全站视觉统一到 Stripe 语言（电光靛蓝 + 发丝边框 + 柔和分层阴影 + 负字距排版 + 金额等宽数字），去掉辉光/玻璃等消费级装饰；布局与信息架构不变。

## 设计基准

取自 `getdesign.md/stripe` 的 DESIGN.md：

### 色彩

| 语义 | 值 | 用途 | 替换现有 |
|---|---|---|---|
| Primary | `#533afd` | 主 CTA、品牌、链接 | `--brand-500` (#007aff) |
| Indigo Deep | `#4434d4` | 渐变中段、按下态 | 新增 `--brand-600` |
| Indigo Soft | `#665efd` | 产品 UI 强调、hover | 新增 `--brand-400` |
| Ink | `#0d253d` | 正文/标题 | `--text-800` |
| Muted | `#64748d` | 次级文字、辅助说明 | `--text-500` |
| Canvas | `#ffffff` | 默认内容面 | `--background-50` |
| Canvas Alt | `#f6f9fc` | 次级面/分区填充 | `--background-100/200` |
| Hairline | `#e3e8ee` | 1px 分隔线、卡片边框 | `--background-300` |
| Input border | `#cfd7df` | 输入框默认边框 | `--background-400` |
| Ruby | `#ea2261` | 第二强调色、图表 | `--chart-*` 之一 |
| Brand Dark 900 | `#1c1e54` | 深色 chrome、精选档位 | 新增 |
| Canvas Cream | `#f5e9d4` | 暖色插叙带 | 新增 |

语义状态色（Stripe preview 未列，按其克制风格派生）：success `#1a7f37`、warning `#9b6829`、error `#df1b41`。

### 排版

Stripe 用 Sohne（专有，display 为 **weight 300 细体**）。替代：`--font-sans` 首选 **Inter**（含 300 字重，可变字重 + `tnum` 支持），`--font-mono` 保留 JetBrains Mono，CJK 回落到 PingFang SC / Microsoft YaHei。

| 层级 | 字号/字重/行高/字距 |
|---|---|
| display-xxl | 56 / 300 / 1.12 / -1.4px |
| display-lg | 50 / 700 / 1.12 / -0.6px |
| display-md | 32 / 700 / 1.25 / -0.256px |
| heading-lg | 24 / 700 / 1.33 |
| body-lg | 18 / 400 / 1.55 |
| body-md | 16 / 400 / 1.55 |
| caption | 14 / 400 / 1.43 |
| button | 16 / 700 / 1.38 / 0.2px |
| micro-cap | 12 / 700 / 1.0 / 0.96px（uppercase eyebrow） |

### 其他基准

- **圆角**：sm 4 / md 8 / lg 12 / xl 16 / button 9999（现有 `--radius: 1.2rem` → `12px`）
- **阴影**：L0 平 / L1 卡片 / L2 光晕 / L3 浮层——低不透明度、大扩散
- **间距**：4 / 8 / 12 / 16 / 24 / 32 / 64（8px 基）
- **金额单元格**：tabular figures（复用已有 `.tabular`）

## 改造清单

### 1. `frontend/src/index.css`（核心，全站生效）

- **原始色板重建**：`--brand-50..900` 改为靛蓝阶梯（500 = `#533afd`）；`--background-*` 改为 Stripe 表面阶梯（白 / `#f6f9fc` / `#e3e8ee` 发丝 / `#cfd7df`）；`--text-*`、`--icon-*` 改为 Stripe ink 阶梯。
- **语义令牌**：`--primary`/`--ring` → `#533afd`；`--border` → `#e3e8ee`；`--input` → `#cfd7df`；状态色替换为派生值；`--radius` → `12px` 并补 sm/md/lg/xl 阶梯；`--shadow-*` 换为 Stripe 分层柔和阴影。
- **渐变收敛**：`--v3-grad-brand` → `135deg #533afd → #665efd`；新增 signature 渐变（`#533afd → #ea2261 → #f96bee`）仅供 Hero 与主 CTA 使用；删除/停用其余多色渐变 token 的滥用点。
- **排版令牌**：`--font-sans` 加入 Inter；新增 display 级字号/字距令牌；新增 `micro-cap` 与 `.money`（tabular 数字）工具类。
- **共享组件类重构**：
  - `.btn-cs`：保留药丸形，`min-height` 44→40，字重 700、字距 0.2px；**移除** `::before`/`::after` 光泽层与 `btnPrimaryGlow`/`btnShine`/`btnGhostGlow` 三个辉光 keyframes。
  - `.card-cs`：1px 发丝边框 + L1 阴影，圆角随新 `--radius`。
  - `.input-cs` / `.field-input`：发丝边框，focus 时用 primary 描边替换发丝（Stripe 规则）。
  - `.nav-cs`：去玻璃拟态，改白底 + 发丝底边；`.nav-link` 去掉下划线渐变条，改 active 文字色 + 轻底色。
  - `.side-link`：active 态改为 indigo 浅底 + 左侧 2px 指示条。
  - `.footer-*`、`.app-shell`、`.app-header`、`.app-content`：间距对齐 8px 基、发丝分隔、去大圆角。
  - `.admin-mcp-light` 桥接块：随新令牌同步（保留，勿删）。

### 2. `frontend/src/styles/animations.css`（动效克制化）

只调 CSS 变量，不动组件：入场位移 `14px → 8px`、初始 blur `5-6px → 2-3px`、时长整体 −20%、卡片 hover 上浮 `-2px → -1px`。保留现有 `prefers-reduced-motion` 降级与 `/anim-tuning` 调参台的变量契约。

### 3. `frontend/src/styles/landing.css`（Home 页专用，~1200 行）

把其中的辉光/玻璃/大圆角/写死色值引用改到新令牌，**不改布局**。

### 4. 共享组件与布局（仅替换非令牌硬编码）

- `components/workbench/WorkbenchPrimitives.tsx`（`WorkbenchPageHeader` / `WorkbenchStatePanel`）
- `components/agents/AgentStatusBadge.tsx`
- `layouts/MainLayout.tsx`、`layouts/WorkbenchShell.tsx`、`layouts/AdminWorkbenchLayout.tsx`
- `components/PageFade.tsx`（如需跟随新动效参数）

### 5. 删除 `frontend/src/App.css`

Vite 模板残留（`.counter`/`.hero`/`#next-steps`/`.ticks`），**无任何文件 import**，且引用了未定义的 `--accent-bg`/`--text-h`/`--social-bg`。

## 明确不做（边界）

- 不改页面布局、信息架构、路由、接口、业务逻辑。
- 不做深色模式。
- **不动页面内 127 处硬编码色**（25 个文件，集中在 `AgentDetail.tsx` 21 / `Profile.tsx` 13 / `MyOrders.tsx` 11 / `MindMapVisualization.tsx` 10 / `AdminAccounts.tsx` 9）。这些会造成局部"新旧混搭"，是本阶段的已知残余，列为后续 phase。

## 验证

1. `cd frontend && npm run lint`
2. `cd frontend && npm run build`（`tsc -b && vite build`，前端无测试套件）
3. `npm run preview` 本地起服务，用浏览器抽查并截图对比关键页面：`/`（Home）、`/market`、`/dashboard`、工作台（agent/workspace）、订单与支付、`/admin`
4. 构建镜像 `genesis-frontend:<TS>` 并部署（`-p 30080:80 --network csi_genesis-net`），确认首页 200、SPA 路由 200、nginx→后端代理仍通

## 风险

- 令牌一改全站生效：必须逐页抽查，重点看依赖渐变/玻璃/大圆角的页面（Home、AgentMarketHub、Dashboard）。
- `landing.css` 体量大且部分色值写死，可能与新令牌冲突，优先抽查。
- Inter 经 Google Fonts 引入；若用户侧网络不可达会回落系统字体，需在抽查时确认字形（必要时后续改为自托管 woff2）。
