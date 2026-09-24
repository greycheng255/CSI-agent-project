# 前端深色模式（Phase 3 · 令牌反相方案）

## Context

Phase 2 收口后，用户要求新开深色模式支持。此前 Phase 2 的边界明确写了「不做深色模式」，本轮为**用户显式新需求**，覆盖该旧边界。

实测现状（本轮勘察结论）：

| 事实 | 数据 | 含义 |
|---|---|---|
| 组件直接引用 **primitive 色板** | **1994 处 / 71 个文件**（`var(--background-*)`、`var(--text-*)` 等） | 若走「语义层迁移」，等于把刚收口的 Step 2/3/4 再动 71 个文件 |
| `bg-white` / `bg-black` | 267 处 / 61 文件 | 需桥接 |
| `bg-white/xx` 半透明 | 仅 **4 处 / 4 文件** | 可逐处改 |
| 色板**深端**（`background-700~900`、`icon-700~900`） | 组件内**几乎未使用** | 「深色表面 vs 墨色」双重角色冲突基本不存在 |
| `--text-50/100/200` | 仅用于 `--surface-code`（深色代码块）上的文字 | **不参与反相** |
| dark-mode 基础设施（`dark:`/`.dark`/`prefers-color-scheme`/theme store） | **0** | 需从零建 |
| `.admin-mcp-light` 桥接块 | **已不存在**（Step 2c 已删） | 无需处理 |

**目标**：全站支持深色模式，切换方式为「浅色 / 深色 / 跟随系统」三态并持久化。不改路由、接口、业务逻辑、信息架构、文案；不引入新依赖（zustand 已在用）。

## 已确认决策

1. **切换方式**：三态「浅色 / 深色 / 跟随系统」+ localStorage 持久化，首访默认跟随系统。
2. **覆盖范围**：全站（营销页/登录/工作台/市场/订单资产/后台管理）；刻意深色视图保持深色。
3. **实现路线**：**令牌反相（ramp inversion）**——在 `[data-theme='dark']` 下重定义整套 primitive 色板，组件代码几乎零改动。

## 架构：令牌反相 + 少量桥接

原理：组件 1994 处引用的是**浅色语义下**的 primitive（`--background-50`=最浅画布、`--text-800`=墨色）。深色主题下把这两条阶梯**整体翻转**（`background-50`→最深画布、`text-800`→近白），所有引用自动跟随，无需改组件。

**反相范围**（`[data-theme='dark']` 覆盖）：

- 反相：`--background-50 … --background-900`（表面/发丝/边框阶梯）、`--text-300 … --text-900`、`--icon-300 … --icon-900`
- **不反相（刻意保留）**：`--text-50/100/200`（深色代码块上的文字）、`--surface-code`、`--v3-white`、`--alipay-*`（渠道品牌色）、`--brand-*`、`--state-*`、`--primary-foreground`、`--state-*-foreground`（白字）
- 语义层（`--background`/`--foreground`/`--card`/`--border`/`--input` 等）已 `var()` 指向 primitive → **自动跟随，无需重写**
- 单独覆盖：glass/nav 的 rgba 白（`--v3-nav-bg-light`/`--v3-glass-bg`/`--v3-glass-bg-strong`）、`--v3-footer-social-bg`、`--v3-shadow-soft/card`、`--shadow-*`、骨架 shimmer 渐变、`color-scheme: dark`

代表值（最终以对比度 ≥4.5:1 微调）：画布 `#0b1220`、次级面 `#101a2e`、发丝 `#22304b`、输入边框 `#33456a`、墨色 `#eef3fa`、静音文字 `#b9c6da`。

**桥接（少量，集中在一处）**：

- `[data-theme='dark'] .bg-white { background-color: var(--background-50); }`（Tailwind 工具类在 @layer 内，未分层规则优先级更高，可覆盖；不影响 `text-white`，白字仍在品牌按钮上成立）
- 4 处 `bg-white/xx` 逐处改为令牌色（`MockAlipayCheckout`、`Profile`、`AdminSsoClients`、`plugins/voiceClone`）
- index.css 内联 rgba 阴影（`.btn-primary:hover` 等，约 784–795 / 1620–1631 / 1472 / 1747 行）在深色块内覆盖为深色阴影 / 亮色 shimmer

## 实施步骤

### Step 0 — 主题基础设施（唯一结构性改动）

| 文件 | 内容 |
|---|---|
| `src/store/themeStore.ts`（新增） | 仿 `src/store/authStore.ts` 的 zustand 模式；`mode: 'light'\|'dark'\|'system'`，`setMode`；用 `persist` 中间件写 localStorage（key `csi-theme`） |
| `src/components/ui/ThemeProvider.tsx`（新增） | 用 effect 把解析后的主题写入 `document.documentElement.dataset.theme`；`mode==='system'` 时监听 `matchMedia('(prefers-color-scheme: dark)')` 变化；同步设置 `color-scheme` |
| `index.html` | `<head>` 内联小脚本：读 localStorage 并尽早设置 `data-theme`，**防首屏闪白（FOUC）** |
| `src/App.tsx` | 在 `BrowserRouter` 内层、`ConfirmProvider` 同级挂 `ThemeProvider`（参照现有 Provider 链，见 App.tsx 约 65–153 行） |

### Step 1 — index.css 深色令牌与桥接

- 新增 `[data-theme='dark'] { … }` 块（置于 `:root` 之后），按上文「反相范围」写入。
- 新增 `.bg-white` 深色桥接规则与 shimmer/阴影覆盖。
- `color-scheme` 由 `:root` 的 light 改为按主题切换。

### Step 2 — 切换 UI

- `src/layouts/MainLayout.tsx`：`nav-right`（约 194–232 行）加三态切换控件（Sun/Moon/Monitor 图标），沿用现有 `h-10 w-10` 图标按钮模式；移动端面板（约 235–284 行）加同款入口。
- （可选）`src/pages/Profile.tsx` 设置区加「外观」行，复用现有 label+control 行样式。

### Step 3 — 清理残留硬编码（保证深色下不刺眼）

- `components/AcceptanceChecklist.tsx`：`bg-blue-600 text-white` 按钮 → `btn-cs btn-primary`。
- `text-gray-*` / `bg-blue-*` 残留（`AgentManagement` 5、`AgentDetail` 1、`agents/AgentSkillTags` 3、`plugins/music` 2、`plugins/voiceClone` 4）→ 令牌色。

### Step 4 — 刻意深色组件核对（保持深色）

`BidDetailPanel`、`FlashcardStudyView`、`MindMapVisualization`、`plugins/*`、`OpenclawBindGuide`、两个 `AdminMCP*Panel`、`bg-black/*` 遮罩、`--surface-code` 代码块：确认深色主题下对比仍成立；必要时仅补边框/分隔线。`MainLayout` 品牌徽标 SVG 的 `#fff` 装饰点为渐变底上白点，两主题均成立，不动。

### Step 5 — 验收

- `cd frontend && npx eslint <改动文件>`（0 报错）→ `npm run lint`（基线仅 3 个既有 hooks 报错）→ `npm run build`
- 构建镜像 `genesis-frontend:<TS>` → `docker rm -f genesis-frontend && docker run -d --name genesis-frontend --network csi_genesis-net -p 30080:80 genesis-frontend:<TS>` → 核对容器内 index.html md5 与本地 dist 一致
- 公网 `https://www.csi.shopping` 走查（子代理无法访问 localhost）：市场 → 任务详情 → 下单支付 → 工作台交付 → 验收，另抽登录/营销页/后台
- 深色专项：硬刷新无闪白（FOUC）、系统偏好切换即时生效、刷新后保持、`prefers-reduced-motion` 不受影响、静音文字/占位符对比度 ≥4.5:1

## 关键文件

- 令牌与主题：`frontend/src/index.css`、`frontend/index.html`
- 基础设施：`frontend/src/store/themeStore.ts`（新）、`frontend/src/components/ui/ThemeProvider.tsx`（新）、`frontend/src/App.tsx`
- 切换 UI：`frontend/src/layouts/MainLayout.tsx`、（可选）`frontend/src/pages/Profile.tsx`
- 清理：`frontend/src/components/AcceptanceChecklist.tsx`、`frontend/src/pages/AgentManagement.tsx`、`frontend/src/pages/AgentDetail.tsx`、`frontend/src/components/agents/AgentSkillTags.tsx`、`frontend/src/features/agent-market/plugins/*`

## 边界（明确不做）

- 不改路由、接口、业务逻辑、数据结构、信息架构、文案
- 不引入新依赖（复用已有 zustand + persist）
- 不做「深色/浅色」以外的主题（如高对比、护眼）
- 刻意深色视图不改设计语言，仅做对比度核对
