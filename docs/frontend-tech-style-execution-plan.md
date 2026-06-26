# 前端科技风视觉改造执行方案

## 目标

在不改变当前项目页面功能、路由、接口请求、状态管理和交互逻辑的前提下，重塑前端视觉系统、布局层级和组件呈现，让界面从“AI 暗色模板感”转向“可信、精密、科技风产品工作台”。

## 改造边界

- 保留现有页面功能、按钮行为、表单字段、数据请求、路由和业务流程。
- 不重写业务逻辑，不调整 API，不改变权限和角色判断。
- 只调整颜色、排版、间距、导航呈现、卡片样式、状态标签、加载态、空状态和响应式布局。
- 科技风不等于黑底绿字终端风，应以冷静、克制、数据可信为主。

## 设计方向

- 背景使用深石墨和冷黑色阶，避免纯黑大面积铺底。
- 主色使用电蓝或冷蓝，主要用于当前状态、主按钮、焦点和关键数据。
- 绿色仅用于成功状态，不作为全站品牌主色滥用。
- 琥珀色用于风险、待处理和警示。
- 红色用于错误、失败、危险操作。
- 字体以系统 sans 为主，`font-mono` 只用于 ID、金额、代码、日志和技术数据。
- 卡片圆角统一在 6-8px，避免大圆角和装饰性 glow。
- 去掉渐变文字、侧边彩条、泛紫/青/绿高亮、重复卡片堆叠等 AI UI 指纹。

## 阶段 1：建立统一设计基线

### 目标文件

- `frontend/src/index.css`
- `frontend/src/App.css`
- 可新增：`frontend/src/styles/tokens.css`

### 执行动作

1. 建立统一 design tokens：
   - `--bg-page`
   - `--bg-shell`
   - `--bg-panel`
   - `--bg-panel-muted`
   - `--border-subtle`
   - `--border-strong`
   - `--text-primary`
   - `--text-secondary`
   - `--text-muted`
   - `--accent-primary`
   - `--state-success`
   - `--state-warning`
   - `--state-error`
   - `--state-info`
2. 清理 Vite 模板残留样式。
3. 移除全局 `font-mono` 依赖。
4. 建立基础样式类：
   - `.app-shell`
   - `.surface`
   - `.panel`
   - `.metric`
   - `.status-badge`
   - `.control`
   - `.primary-action`
5. 统一 focus、hover、disabled、loading 的视觉反馈。

### 验收标准

- 全站不再依赖随机 Tailwind 色值表达品牌。
- 页面看起来属于同一个产品系统。
- `$impeccable detect` 中与渐变文字、AI 色板、侧边强调条相关的问题开始减少。

## 阶段 2：重构主布局视觉

### 目标文件

- `frontend/src/layouts/MainLayout.tsx`

### 执行动作

1. 保留所有现有 `NavLink` 路由。
2. 将主框架改为：
   - 顶部：品牌、系统状态、用户区。
   - 左侧：主导航分组。
   - 用户登录后：显示普通用户和 Agent owner 工作区入口。
   - Admin 登录后：显示管理后台入口。
3. 避免把市场、任务、仪表盘、API、Owner、Admin 全部塞进同一个横向导航。
4. 当前页面高亮使用低调 active 背景和细标记，不使用粗彩边。
5. 移除全局黑底绿字终端风。
6. 移动端使用折叠菜单或分组导航，避免横向溢出。

### 验收标准

- 顶部导航在 1366px 和移动端都不拥挤。
- 不同角色的菜单不会同时争抢视觉权重。
- 用户 5 秒内能理解主要入口。

## 阶段 3：首页去模板化

### 目标文件

- `frontend/src/pages/Home.tsx`

### 执行动作

1. 删除 `bg-clip-text` 和渐变标题。
2. 首页第一屏改为产品入口工作台：
   - 平台价值说明。
   - 三个保留原路由的主入口：发布任务、智能体集市、浏览任务大厅。
   - 平台运行状态摘要。
3. 将 `Stats Dashboard` 改为紧凑系统状态区。
4. 将 `Live Feed` 改为“最近活动 / 交易事件”，降低终端日志感，增强业务可信度。
5. 控制首页卡片数量，避免营销模板式堆叠。

### 验收标准

- 首页第一屏明确表达 AI Agent 任务交易平台。
- CTA 路径不变。
- 不再像 Vite 模板、Web3 黑绿模板或 AI 生成 landing page。

## 阶段 4：Dashboard 数据层级重排

### 目标文件

- `frontend/src/pages/Dashboard.tsx`

### 执行动作

1. 保留现有数据请求、刷新和错误处理逻辑。
2. 将六个指标卡重排为：
   - 一级指标：营收、任务、完成率。
   - 二级指标：报价、订单、在线 Agent。
3. 统一指标卡视觉语言，减少随机多彩 icon。
4. 图表面板统一高度、标题、单位、空状态和 loading 样式。
5. 将“快速链接”改为右侧快捷操作列表或顶部 action group。

### 验收标准

- 用户第一眼能判断业务是否健康。
- 不再出现六个同款卡片平均分布的 AI dashboard 感。
- 关键数据、趋势和操作区层级清晰。

## 阶段 5：任务大厅改成交易列表

### 目标文件

- `frontend/src/pages/Market.tsx`

### 执行动作

1. 保留搜索、标签、预算、排序、刷新和状态筛选逻辑。
2. 将过滤器区收敛为紧凑工具栏：
   - 搜索为主。
   - 预算和排序为二级控件。
   - 状态 tabs 保留但视觉更克制。
3. 删除任务卡左侧彩色竖条。
4. 将任务卡改为交易列表结构：
   - 标题 + 状态
   - 预算
   - 截止时间
   - 报价数
   - 匹配 Agent
   - 查看详情
5. 标签使用细边框和低饱和底色，不用大面积彩色背景。

### 验收标准

- 任务大厅更像任务交易市场，而不是 AI 卡片流。
- 预算、状态、截止时间和报价数可快速扫描。
- 列表密度提升，但不牺牲可读性。

## 阶段 6：智能体集市统一组件语言

### 目标文件

- `frontend/src/pages/AgentMarketHub.tsx`
- `frontend/src/data/agentMarketCatalog.ts`
- `frontend/src/features/agent-market/plugins/*`

### 执行动作

1. 保留卡片点击、筛选和目录加载逻辑。
2. 检查 `agent.icon` 是否使用 emoji；结构性图标优先替换为 Lucide。
3. 统一 Agent 卡片结构：
   - 名称
   - 描述
   - 能力标签
   - 可运行状态
   - 调用量 / 评分
4. 不同类型 Agent 只使用小面积类型标识，不使用大面积随机颜色。
5. “接口未开放”“运行”等状态统一为标准 badge。

### 验收标准

- 集市像真实产品目录，而不是 prompt 生成的工具卡片库。
- Agent 类型和可运行状态一眼可辨。
- 卡片之间的视觉差异来自内容，而不是随机颜色。

## 阶段 7：全局 AI 味清理

### 全局搜索并处理

- `bg-clip-text`
- `bg-gradient`
- `text-purple-*`
- `text-cyan-*` 的滥用
- `border-l-4`
- `border-b-2` 作为装饰强调
- `rounded-xl`
- `rounded-2xl`
- `shadow-[...]`
- 大面积 `font-mono`
- 彩色背景上的 `text-gray-*`

### 优先处理文件

- `frontend/src/pages/Home.tsx`
- `frontend/src/pages/ApiDocs.tsx`
- `frontend/src/pages/AgentManagement.tsx`
- `frontend/src/pages/AgentDetail.tsx`
- `frontend/src/pages/FinanceManagement.tsx`
- `frontend/src/pages/MyOrders.tsx`
- `frontend/src/components/DeliveryForm.tsx`
- `frontend/src/components/DeliveryHistory.tsx`
- `frontend/src/components/AcceptanceChecklist.tsx`

### 验收标准

- `$impeccable detect` 命中数明显下降。
- 没有明显的 AI 暗色渐变卡片模板痕迹。
- 状态色有语义，不再只是装饰。

## 阶段 8：验证与回归

### 构建验证

```powershell
cd D:\task\CSI\frontend
npm.cmd run build
```

### 设计检测

```powershell
cd D:\task\CSI
node .agents/skills/impeccable/scripts/detect.mjs --json frontend/src
```

### 核心路由检查

- `/`
- `/dashboard`
- `/market`
- `/agent-market`
- `/tasks/new`
- `/owner/agents`
- `/admin/agents`

### 检查项

- 页面是否横向溢出。
- 顶栏和侧栏是否拥挤。
- 表单是否仍可输入。
- 按钮是否仍触发原逻辑。
- loading、error、empty 状态是否清晰。
- 文字对比度是否满足基本可读性。
- 角色菜单是否按登录状态正常显示。

## 推荐 PR 拆分

### PR 1：设计基线与主布局

- 新增或整理 design tokens。
- 清理全局模板样式。
- 改造 `MainLayout.tsx` 的视觉和导航呈现。
- 不触碰业务逻辑。

### PR 2：首页、Dashboard、任务大厅

- 改造 `Home.tsx`。
- 改造 `Dashboard.tsx`。
- 改造 `Market.tsx`。
- 聚焦核心第一印象和主要工作流。

### PR 3：智能体集市与全局 AI 味收敛

- 改造 `AgentMarketHub.tsx`。
- 统一 Agent 卡片和状态 badge。
- 清理检测器命中的剩余 AI 反模式。
- 执行构建和设计检测。

## 最终验收标准

- 功能、路由、接口请求和业务交互保持不变。
- 核心页面在桌面和移动端都无明显布局破裂。
- 全站视觉语言统一，科技风克制可信。
- 渐变文字、侧边彩条、随机高饱和色、大圆角卡片堆叠等 AI 味明显减少。
- `npm.cmd run build` 通过。
- `$impeccable detect` 命中数较改造前显著下降。
