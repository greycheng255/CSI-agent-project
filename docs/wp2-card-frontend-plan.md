# Agent Card 前端实现方案

> 日期: 2026-06-19 | 对接 WP-2 后端 Agent Card API

---

## 1. 目标

补齐前端对 Agent Card 的展示、注册、预览能力，与后端 API 对齐。

---

## 2. 改动清单

| # | 页面/组件 | 操作 | 说明 |
|---|----------|------|------|
| 1 | `AgentManagement.tsx` | 🔧 改造 | 创建表单增加"外部自托管"Tab |
| 2 | `AgentDetail.tsx` | 🔧 改造 | 新增 Card 信息展示区块 |
| 3 | `CreateAgentForm.tsx` | 🆕 新建 | 注册表单组件（双模式） |
| 4 | `AgentCardPreview.tsx` | 🆕 新建 | Card JSON 预览组件 |
| 5 | `CardSection.tsx` | 🆕 新建 | 详情页 Card 展示区块 |

---

## 3. 详细设计

### 3.1 `CreateAgentForm.tsx` — 注册表单

```
┌─────────────────────────────────────────────┐
│  注册 Agent                                  │
│                                             │
│  [平台托管]  [外部自托管]   ← Tab 切换       │
│                                             │
│  ▸ 平台托管模式:                              │
│    名称*: [_______________]                  │
│    描述*: [_______________]                  │
│    技能*: [python] [nodejs] [+添加标签]       │
│    领域*: [backend] [web] [+添加标签]         │
│    自定义标签: [开源] [免费] [+添加]          │
│    定价模式: ○ 按次  ○ 按小时  ○ 固定价       │
│    最低价: [_____] 元                        │
│    Endpoint: [_______________] (可选)         │
│    Health URL: [_______________] (可选)       │
│    Auth Type: [bearer ▼]                    │
│    联系邮箱: [_______________]               │
│                                             │
│  ▸ 外部自托管模式:                            │
│    Card URL*: [https://.../agent-card.json]  │
│    或 粘贴 JSON: [_______________]            │
│    ┌─ 预览 ────────────────────────────┐    │
│    │ 名称: xxx  版本: 1.0.0             │    │
│    │ 端点: https://xxx.com/tasks        │    │
│    │ 健康: https://xxx.com/health       │    │
│    │ 技能: [python] [nodejs]            │    │
│    │ 领域: [web] [data]                 │    │
│    │ 定价: quote, ¥50起                 │    │
│    └────────────────────────────────────┘    │
│                                             │
│  [取消]  [注册]                               │
└─────────────────────────────────────────────┘
```

**交互要点**:
- Tab 切换时保留已填写的公共字段
- 外部模式: Card URL 输入 → 失焦时自动 fetch → 展示预览
- 外部模式: 粘贴 JSON → 实时校验 JSON Schema（前端校验必填字段）
- 提交前确认审核提示

**调用 API**:
- 平台托管: `POST /api/v1/agents/register`
- 外部托管: `POST /api/v1/agents/register-external`

### 3.2 `AgentDetail.tsx` — 新增 Card 区块

在现有页面底部或"接入信息"区域后插入：

```
┌─ Agent Card ─────────────────────────────┐
│  当前版本: 1.0.0                          │
│  来源: platform (平台自动生成)             │
│  内容哈希: bc59ef3e...                    │
│                                           │
│  ┌─ Card 详情 ─────────────────────────┐  │
│  │ Auth: bearer                        │  │
│  │ Endpoint: https://example.com/tasks │  │
│  │ Health: https://example.com/health  │  │
│  │ Capabilities:                       │  │
│  │   领域: [wp2-test]                  │  │
│  │   技能: [review-flow][approval]    │  │
│  │   标签: [auto-test]                 │  │
│  │ Pricing: quote, ¥10 起             │  │
│  └─────────────────────────────────────┘  │
└───────────────────────────────────────────┘
```

**数据来源**: `GET /api/v1/agents/:id` 响应中的 `cards[]` 数组，取 `isActive: true` 的那条。

### 3.3 `AgentCardPreview.tsx` — 预览组件

外部注册时，在提交前展示 Card 解析结果。可复用 — 在 AgentManagement 的创建弹窗和独立详情页都可用。

```
┌─ Card 预览 ─────────────────────────────────┐
│  ✅ Card 解析成功                             │
│                                              │
│  Agent 名称: Python 爬虫专家                  │
│  版本: 0.1.0                                  │
│  描述: 专注于网页数据采集...                   │
│                                              │
│  ┌─ 端点 ──────────────────────────────────┐ │
│  │ Task: https://my-agent.com/api/tasks    │ │
│  │ Health: https://my-agent.com/api/health │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  ┌─ 能力 ──────────────────────────────────┐ │
│  │ 技能: [python] [scrapy] [data-cleaning] │ │
│  │ 领域: [data] [crawler]                  │ │
│  │ 模型: [gpt-4.1]                         │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  ┌─ 定价 ──────────────────────────────────┐ │
│  │ 模式: quote | 最低价: ¥50               │ │
│  └─────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

---

## 4. 实施任务

| # | 任务 | 文件 | 工时 |
|---|------|------|------|
| **Day 1** | | | |
| 1 | 新建 `CreateAgentForm.tsx`（双模式表单 + 标签输入组件） | 新建 | 2h |
| 2 | 新建 `AgentCardPreview.tsx`（Card JSON 解析+展示） | 新建 | 1.5h |
| 3 | 改造 `AgentManagement.tsx`（集成新表单，替换旧弹窗） | 修改 | 1.5h |
| **Day 2** | | | |
| 4 | 新建 `CardSection.tsx`（Card 信息展示区块） | 新建 | 1h |
| 5 | 改造 `AgentDetail.tsx`（集成 CardSection） | 修改 | 1h |
| 6 | 更新路由和导航（确保 `/agents/:id` 公开详情路径） | 修改 | 0.5h |
| 7 | 联调测试（注册→Card展示→外部注册→预览） | — | 1h |

---

## 5. 验收标准

- [ ] 平台托管注册表单包含 skills/domains/tags/pricing 输入
- [ ] 外部自托管注册可通过 Card URL 自动抓取预览
- [ ] 外部自托管注册可通过粘贴 JSON 注册
- [ ] Agent 详情页展示 Card 区块（版本、端点、能力、定价）
- [ ] Card 预览组件在提交前展示解析结果
