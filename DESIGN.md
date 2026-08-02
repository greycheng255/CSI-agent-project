# Design

碳硅视觉系统，移植自「首页 v3」参考样例（Apple HIG 风格的 Pinguo tokens）。实现位置：`frontend/src/index.css`（令牌 + 全局组件）、`frontend/src/styles/landing.css`（落地页区块）。

## Color

策略：**Restrained**（ tinted neutrals + 品牌蓝 accent ≤10%，蓝紫渐变仅用于品牌时刻）。

- 主色：System Blue `#007AFF`（`--brand-500`），hover `#2E8DFF`（`--brand-400`）
- 辅助渐变：`#007AFF → #5856D6`（`--v3-grad-brand`，品牌 Logo/主按钮）；紫 `#5856D6 → #AF52DE`；绿 `#34C759 → #30D158`；橙 `#FF9500 → #FF7A00`
- 背景：`#FFFFFF`（`--background-50`）、`#F7F7FA`、`#F2F2F7`；深色区块 `#000000`/`#1C1C1E`（实时交易流、大数字）
- 文字：`#1D1D1F`（`--text-800`）主、`#8E8E93`（`--text-400`）次、`#6E6E73`（`--text-500`）辅
- 状态：成功 `#34C759`、错误 `#FF3B30`、链接蓝 `#0A84FF`
- Hero/CTA 底：`linear-gradient(180deg, #FFF 0%, #E8F2FF 100%)`；功能矩阵底：`#F7F5FF → #FFF`

## Typography

- Sans：`DM Sans, ui-sans-serif, system-ui, sans-serif`（正文/标题同族，字重对比：700/800 标题 vs 400 正文）
- Mono：`JetBrains Mono, monospace`（仅实时交易流行、任务号、金额）
- Hero H1：`clamp(32px, 4.5vw, 60px)` / 800 / -0.02em；CTA H2：`clamp(32px, 5vw, 56px)`
- 区块标题 36px/800/-0.02em；副标题 17px；正文 14–15px/1.6
- 强调方式：品牌词用纯色 `--chart-4` 紫（`.hero-h1 .grad`），不用渐变文字

## Shape & Depth

- 圆角：卡片 1.2rem；图标方块 14px；按钮/胶囊 980px 全圆角
- 阴影：Apple 式柔和分层（`--shadow-sm` 卡片 → `--shadow-2xl` 模态）；主按钮带蓝色外发光 `rgba(0,122,255,.35)`
- 玻璃拟态仅用于有背景层次处的卡片（stat/feature/model/testimonial：`rgba(255,255,255,.65)` + blur 16px），普通卡片用白底 + 1px `--background-300` 边框

## Layout

- 容器：max-width 1200px，左右 padding 1.25rem（`.container-cs`）
- 导航：sticky、52px 高、透明底 + 滚动后毛玻璃（`rgba(255,255,255,.72)` + blur）
- 区块节奏：section padding 5rem；CTA 128px；深色区块（bignum/feed）打断浅色流
- 网格：旗舰智能体 2 列、功能矩阵/为什么选择 3 列、评价 3 列；<768px 全部单列

## Motion

- 滚动 reveal：`.reveal` 上移 28px + scale .98 → 归位，0.7s；feed 行左滑入，90ms 阶梯
- 环境动效：hero 光斑呼吸（7–8s alternate）、bg-mesh 渐变漂移 24s、浮动粒子上升、光斑滚动视差
- 微交互：按钮磁吸位移（0.2 系数）、卡片 3D 倾斜（±3deg）、卡片聚光灯（--mx/--my 径向高光）、主按钮 hover 发光脉冲 + 光泽扫过、点击 ripple
- 降级：`prefers-reduced-motion` 全部关闭并直接呈现内容

## Components

- `.btn-cs`：胶囊按钮。`.btn-primary` 蓝紫渐变 + 内高光 + 蓝紫双层投影；`.btn-ghost-dark` 浅蓝 tinted  ghost；`.btn-nav` 导航尺寸
- `.badge-pill`：蓝紫 tinted 胶囊徽章（Sparkles/Rocket 图标）
- `.model-card / .feature-card / .step-card / .testimonial-card`：玻璃卡片家族；step-card 顶部 4px 渐变条（蓝/紫/绿）
- `.feed-container`：深色面板 + mono 网格行（90px 1fr 90px 110px 1fr），状态徽章绿/橙/蓝/紫
- `.faq-item`：details/summary 手风琴，+ 号旋转 45°
- `.nav-link`：14px/600，hover 品牌蓝 + 底部渐变下划线展开
- 品牌标记：28px 圆角 8px 渐变方块（`.nav-brand-mark`）+「碳硅」
