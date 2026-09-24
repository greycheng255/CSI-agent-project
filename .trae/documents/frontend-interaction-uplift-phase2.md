# 前端全站「细节与交互」升级（Phase 2）

## Context

上一阶段已完成 **令牌层 + 共享组件层** 的 Stripe 浅色改造并上线（镜像 `genesis-frontend:20260924-105037`），全站主色、圆角、阴影、字体已统一。

用户本轮要求把范围扩大到 **整个前端的细节与交互**，达到「大厂」水准。本轮实测扫描出的真实缺口：

| 缺口 | 实测数据 | 影响 |
|---|---|---|
| 原生 `alert()` / `window.confirm()` | **84 处 / 16 个文件**（OrderDetail 29、AgentDetail 12、AgentManagement 11） | 最刺眼。阻断式浏览器弹窗、无法定制、无品牌感、不可访问 |
| 硬编码色值 | **173 处 / 37 个 tsx**（AgentDetail 21、AdminMCPIntegrationCenterPanel 15、Profile 13、MyOrders 11、MindMapVisualization 10、AdminAccounts 9） | 局部与令牌层新旧混搭 |
| 无统一 Toast | 全站 0 个 toast 组件 | 操作反馈靠 alert，成功后无轻量反馈 |
| 无 Skeleton | 仅 `App.tsx` 的 `PageFallback` 有两块 pulse | 列表/详情 loading 多为 spinner，布局跳动 |
| 无共享状态面板 | 仅 `WorkbenchStatePanel`（工作台内） | 各页手搓空/错态，文案层级与尺寸不一 |
| 无共享 Dialog / Table 原语 | 各页手搓 | 弹层焦点管理、表格密度不一致 |
| 可访问性覆盖稀疏 | `focus-visible`/`aria-*` 仅 94 处 / 40 文件 | 键盘可达性与读屏体验不达标 |

**目标**：把交互反馈、状态表达、表格/弹层规范、键盘可达性收口到一套统一基准，并清零硬编码色值。布局、信息架构、路由、接口、业务逻辑均不变。

## 设计基准（从 awesome-design-md 提炼的「组件交互规范」）

从 73 份 DESIGN.md（Stripe / Linear / Vercel / Raycast / Supabase 等）归纳的统一基准，本轮所有改动以此为准：

### 按钮 6 态矩阵

| 态 | 视觉 | 规则 |
|---|---|---|
| default | 主按钮实心靛蓝 / 次按钮白底发丝边框 | 高度 40（`sm` 36） |
| hover | 主按钮加深一档 + 位移 `-1px`；次按钮转 `brand-50` 底 + `brand-400` 边框 | 位移**不超过 1px**，禁止放大 |
| active | 位移归 0，无额外阴影 | 立即反馈 |
| focus-visible | 2px `brand-500` 环 + 2px offset | **仅键盘可见**（`:focus-visible`） |
| disabled | `opacity: .5`，`cursor: not-allowed`，无位移 | 保留对比度可读 |
| loading | 左侧 14px spinner 替换图标位，文字保持，`aria-busy` | 宽度不跳动 |

### 表格密度与对齐

- 表头：12px / 700 / uppercase / `0.96px` 字距（`.micro-cap`），`--text-500`，发丝底边
- 行高：宽松 52px / 默认 44px / 紧凑 36px；行分隔用 `--background-200` 1px
- 行 hover：仅换底色（`--background-100`），**不位移**
- 金额列：右对齐 + `.money`（tabular figures）；状态列：左对齐 + 药丸徽标
- 响应式：`< 768px` 降级为卡片列表（不横向滚动）

### 状态四态

| 态 | 规格 |
|---|---|
| empty | 虚线边框面板，48px 圆底图标，标题 16/600，说明 14/`--text-500`，可选主操作按钮 |
| loading | Skeleton 骨架（尺寸对齐真实内容，避免布局跳动）；**不用 spinner 撑版式** |
| error | 同上结构，`--state-error` 色系，附「重试」按钮 |
| success | Toast（轻量）+ 页面内徽标（持久）；不弹阻断窗 |

### 表单反馈时机

1. **输入中**：不做实时报错，仅清空上一次错误
2. **失焦**：字段级校验 → 行内错误（红字 13px + 输入框 `--state-error` 边框）
3. **提交时**：首个错误字段自动聚焦 + 滚动入视口
4. **提交中**：按钮进 loading 态，表单 `aria-busy`
5. **成功后**：`toast.success` + 就地状态更新（不跳页、不弹窗）

### 焦点环 / 触达 / 动效

- 焦点环统一 `2px solid var(--brand-500)` + `outline-offset: 2px`
- 触达目标 ≥ 40×40px（移动端 ≥ 44px）
- hover 位移：卡片 `-1px`、按钮 `-1px`、行 `0`；入场位移 8px、时长沿用 `styles/animations.css` 变量
- 全部尊重 `prefers-reduced-motion`

## 实施计划

### Step 0 — 新增共享 UI 原语（`frontend/src/components/ui/`，零新依赖）

| 文件 | 内容 |
|---|---|
| `Toast.tsx` / `useToast.ts` | `ToastProvider` + `useToast()`；四种 tone（success/error/warning/info），右上角堆叠，默认 4s 自动消失，可带 action 按钮；容器 `aria-live="polite"`、`role="status"` |
| `ConfirmDialog.tsx` / `useConfirm.ts` | Promise 化 `const ok = await confirm({ title, description, tone, confirmText })`；`danger` tone；支持 `requireReason`（退回 / 拒绝场景内联必填原因）；焦点陷阱 + Esc 关闭 + 滚动锁 + `role="dialog"` `aria-modal` |
| `Skeleton.tsx` | `Skeleton` / `SkeletonText` / `SkeletonTable`；shimmer 动效走 `animations.css` 变量，reduced-motion 下静态 |
| `StatePanel.tsx` | 把 `WorkbenchStatePanel` 泛化为全站通用（`empty`/`loading`/`error`/`denied` 四 tone）；`WorkbenchStatePanel` 改为其薄封装，保持现有 20+ 处调用不变 |
| `DataTable.tsx` | 轻量表格原语：表头 micro-cap、发丝行分隔、行 hover 底色、金额列 `.money` 右对齐、`<th scope>`、`<768px` 卡片降级 |
| `index.css` 补充 | `.btn-cs:disabled` / `.btn-cs--loading`（含 spinner 关键帧）、`.btn-secondary`（次按钮显式类名）、`.field-error` 行内错误、`.badge-cs` 状态徽标统一类 |

`App.tsx` 根部挂载 `ToastProvider` + `ConfirmProvider`（唯一结构性改动，包在 `BrowserRouter` 内层）。

### Step 1 — 清除原生 alert / confirm（16 文件 84 处）

语义映射：

| 原用法 | 替换为 |
|---|---|
| `alert('xx已提交')` | `toast.success('xx已提交')` |
| `alert('失败: ...')` / `alert(err.message)` | `toast.error(...)` |
| `window.confirm('确定要X吗？')` | `await confirm({ title, description, tone: 'danger', confirmText: 'X' })` |
| 校验类 `alert('请填写原因')` | 改为**行内字段错误**，不弹窗 |
| `alert('请先登录')` | `toast.warning` + 跳登录 |

顺序（按流量与资金风险）：`OrderDetail`(29) → `AgentDetail`(12) → `AgentManagement`(11) → `TaskDetail` → `EmployerOrderDetail` → `Profile` → `AdminPlatformCodes` → `AdminRelease` → `AdminArbitrations` → `AdminAgents` → `AdminEntitlement` → `PaymentCodes` → `LongTaskSeats` → `MyPlan` → `AdminMCPPlatformPanel` → `MainLayout`。

### Step 2 — 硬编码色值清零（37 文件 173 处）

分三批，每批独立 build 验证：

- **2a 高流量页**：`AgentDetail`、`MyOrders`、`MyAgentWork`、`Dashboard`、`AgentManagement`、`AgentMarketHub`、`Market`、`AgentMarket`
- **2b 交易与资产页**：`OrderDetail`、`EmployerOrderDetail`、`TaskDetail`、`OwnerLongtaskOrders`、`MyBalance`、`MyPayments`、`MyReceipts`、`RechargeBalance`、`OrderPayment`、`PaymentCodes`、`OnlineAlipayPayment`、`OnlineAlipayRecharge`、`MockAlipayCheckout`
- **2c 管理后台与专项组件**：`AdminAccounts`、`AdminMCP*`(3 个)、`AdminSsoClients`、`AdminRelease`、`AdminWithdrawals`、`AdminAgents`、`AdminArbitrations`、`AdminEntitlement`、`AdminPlatformCodes`、`Profile`、`MindMapVisualization`、`FlashcardStudyView`、`AgentCardPreview`、`DeliveryHistory`、`OpenclawBindGuide`、`WorkspaceShowcase`、`MyWorkspace`、`AgentMarketHub` 等零星

全部改完后 **删除 `index.css` 中的 `.admin-mcp-light` 桥接块**（不再需要）。

### Step 3 — 状态与骨架屏铺开

所有列表页 / 详情页统一四态；loading 由 spinner 换 `Skeleton`，尺寸对齐真实内容。覆盖：`MyOrders`、`MyAgentWork`、`MyBids`、`OwnerLongtaskOrders`、`EmployerOrders`、`Market`、`AgentMarketHub`、`WorkspaceGallery`、`AdminAccounts`、`AdminArbitrations`、`AdminWithdrawals`、`AdminAgents`、`AdminEntitlement`、`AdminRelease`、`AdminSsoClients`、`TaskDetail`、`OrderDetail`、`EmployerOrderDetail`。

### Step 4 — 细节与可访问性收口

- 全站 `:focus-visible` 覆盖：按钮、链接、输入、可点击行、自定义控件
- Dialog 焦点陷阱 / Esc / 滚动锁 / `aria-modal`
- 表格语义（`<th scope>`、`aria-sort`）、可点击行改 `role="row"` + 键盘可达
- 触达目标 ≥ 40px、对比度 ≥ 4.5:1 抽查
- 金额统一 `.money`，时间/编号统一 `.tabular`
- 表单：`aria-invalid` + `aria-describedby` 关联行内错误

### Step 5 — 每批验收闭环

1. `cd frontend && npm run lint`（基线 3 个既有 hooks 报错：`AnimatedNumber.tsx:38`、`AnimTuning.tsx:158`、`Profile.tsx:448`，不新增即可）
2. `cd frontend && npm run build`（`tsc -b && vite build`）
3. 构建镜像 `genesis-frontend:<TS>` → `docker rm -f genesis-frontend && docker run -d --name genesis-frontend --network csi_genesis-net -p 30080:80 genesis-frontend:<TS>`
4. 浏览器抽查**公网** `https://www.csi.shopping`（子代理无法访问 localhost）
5. 关键路径走查：登录 → 市场 → 任务详情 → 下单支付 → 工作台交付 → 验收；另抽后台管理页

## 边界（明确不做）

- 不改路由、接口、业务逻辑、数据结构、信息架构、文案
- **不引入任何新依赖**（Toast / Dialog / Skeleton / DataTable 全部自研）
- 不做深色模式
- 不改页面布局与视觉语言（延续已批准的 Stripe 浅色）

## 风险与对策

| 风险 | 对策 |
|---|---|
| Toast/Confirm 需挂 Provider 到 `App.tsx` 根部，属结构性改动 | 唯一一处结构性改动，只加 Provider 包裹，不动 `<Routes>` |
| 84 处 alert/confirm 替换面广，易漏或误改业务分支 | 按文件分批，每批 build + 人工核对 diff；只替换反馈层，不改判定逻辑 |
| 管理后台 MCP 面板依赖 `.admin-mcp-light` 桥接，删除后可能失色 | 2c 批次最后处理，先改类名再删桥接，逐页抽查 |
| `landing.css`（1414 行）与 `MindMapVisualization` 有写死色 | 单独抽查 Home 与思维导图页 |
