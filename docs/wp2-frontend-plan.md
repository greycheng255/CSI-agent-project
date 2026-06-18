# WP2 Agent 注册 API 前端改造方案

> 日期: 2026-06-18  
> 对接阶段: WP2 Agent Registry / Agent Card / 审核后台  
> 目标: 让用户可以在平台前端完成 Agent 注册、查看注册状态；让管理员可以完成 Agent 审核；让已审核 Agent 可以进入公开发现页。

---

## 1. 背景与目标

WP2 后端已经提供 Agent 注册、外部 Agent Card 注册、Agent 发现、详情查询、心跳、审核等能力。当前前端仍以旧版 Owner Agent 管理为主，主要围绕 `name`、`description`、`webhookUrl`、API Key、Webhook 投递等字段展开，尚未完整体现 WP2 的注册与审核闭环。

本次前端改造目标不是简单给旧表单加字段，而是形成完整用户路径：

1. 用户在「我的 Agent」中注册平台托管 Agent 或外部自托管 Agent。
2. 注册成功后进入「待审核」状态，用户可以看到审核状态和运行状态。
3. 管理员在审核后台查看待审核 Agent，并执行通过、驳回或强制禁用。
4. 通过审核的 Agent 进入「智能体广场」，普通用户可以搜索、筛选、查看公开详情。
5. Owner 私有详情页继续保留 API Key、Webhook、支付、任务等私有管理能力，公开详情页不暴露私有信息。

---

## 2. 当前现状与目标差异

| 页面/模块 | 当前现状 | 改造目标 |
| --- | --- | --- |
| Agent 管理页 `/owner/agents` | 使用旧 Owner API；创建字段较少，主要是 name、description、webhookUrl | 支持 WP2 注册字段；展示审核状态、运行状态、Agent 类型；支持平台托管和外部自托管两种注册模式 |
| Agent 私有详情页 `/owner/agents/:id` | 展示旧 Agent 基础信息、API Key、Webhook、支付等 | 保留私有管理能力，同时补充 Agent Card、能力、标签、审核状态、运行状态、定价信息 |
| 智能体广场 `/agents` | 不存在 | 新增公开发现页，展示已审核 Agent，支持搜索、标签筛选、领域筛选、分页 |
| 公开 Agent 详情 `/agents/:id` | 不存在 | 新增公开详情页，仅展示可公开信息，不暴露 API Key、Owner 私有配置、Webhook 投递等敏感信息 |
| 管理审核页 `/admin/agents` | 不存在 | 新增审核后台，支持待审核、已通过、已驳回、已禁用、全部列表及审核操作 |
| 前端 API 调用 | 页面内直接 `fetch`，旧接口分散 | 新增统一 API client 和类型定义，集中处理 token、错误、接口路径 |

---

## 3. 核心优化原则

### 3.1 注册入口必须区分两种 Agent 模式

注册表单不要只做一个大表单，建议使用 Tab 或分段控件区分：

- 平台托管 Agent
- 外部自托管 Agent

平台托管 Agent 适合由平台管理配置，用户手工填写能力、领域、标签、定价等信息。

外部自托管 Agent 适合已有 Agent Card 的第三方 Agent，用户可以通过 `cardUrl` 或粘贴 `cardJson` 注册。

### 3.2 注册成功后必须明确进入审核流程

Agent 注册 API 完成后，前端不应提示「已上线」或「可直接使用」，而应展示：

> Agent 已提交审核，当前状态：待审核。

同时在「我的 Agent」列表和详情页持续展示：

- `approvalStatus`: `pending_review` / `approved` / `rejected`
- `runtimeStatus`: `online` / `offline` / `degraded` / `timeout`
- `agentType`: `platform` / `external`

### 3.3 Owner 私有详情与公开详情必须隔离

不要直接复用当前 `AgentDetail.tsx` 作为公开详情页。当前 Owner 详情页包含 API Key、支付、Webhook、投递记录等私有信息，如果用于 `/agents/:id` 会产生信息暴露风险。

建议拆分：

- `/owner/agents/:id` 使用 `AgentDetail.tsx`，定位为 Owner 私有控制台。
- `/agents/:id` 新建 `AgentPublicDetail.tsx`，定位为公开详情页。

### 3.4 页面不直接散落 fetch

新增统一 API 封装层：

```text
frontend/src/api/agentsApi.ts
frontend/src/types/agent.ts
```

所有页面通过 API client 调用后端，避免每个页面分别处理路径、token、错误提示和响应结构。

### 3.5 市场页只展示已审核 Agent

智能体广场只能展示：

- `approvalStatus = approved`

可选默认优先展示：

- `runtimeStatus = online`

待审核、已驳回、已禁用 Agent 不应出现在公开发现页。

---

## 4. 前端数据模型

新增或统一前端类型定义文件：

```text
frontend/src/types/agent.ts
```

建议核心类型：

```ts
export type AgentApprovalStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected';

export type AgentRuntimeStatus =
  | 'online'
  | 'offline'
  | 'degraded'
  | 'timeout';

export type AgentType = 'platform' | 'external';

export interface AgentCapability {
  id: string;
  name: string;
  description?: string;
  schema?: Record<string, unknown>;
}

export interface AgentTag {
  id: string;
  name: string;
  type?: 'skill' | 'domain' | 'custom';
}

export interface AgentCardSummary {
  id: string;
  version?: string;
  cardUrl?: string;
  endpointUrl?: string;
  healthUrl?: string;
  authType?: string;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  ownerId?: string;
  agentType: AgentType;
  approvalStatus: AgentApprovalStatus;
  runtimeStatus: AgentRuntimeStatus;
  visibility?: 'public' | 'private';
  version?: string;
  cardUrl?: string;
  endpointUrl?: string;
  healthUrl?: string;
  authType?: string;
  pricingModel?: string;
  basePrice?: number;
  currency?: string;
  reputationScore?: number;
  createdAt?: string;
  updatedAt?: string;
  approvedAt?: string;
  capabilities?: AgentCapability[];
  tags?: AgentTag[];
  cards?: AgentCardSummary[];
}
```

---

## 5. API 封装方案

新增文件：

```text
frontend/src/api/agentsApi.ts
```

建议封装方法：

```ts
export async function registerAgent(payload: RegisterAgentPayload): Promise<Agent>;

export async function registerExternalAgent(
  payload: RegisterExternalAgentPayload,
): Promise<Agent>;

export async function discoverAgents(params: DiscoverAgentsParams): Promise<AgentListResult>;

export async function getAgent(id: string): Promise<Agent>;

export async function getAgentTags(): Promise<string[]>;

export async function listMyAgents(): Promise<Agent[]>;

export async function listAdminAgents(params?: AdminAgentListParams): Promise<Agent[]>;

export async function listPendingAgents(): Promise<Agent[]>;

export async function approveAgent(id: string, note?: string): Promise<Agent>;

export async function rejectAgent(id: string, reason: string): Promise<Agent>;

export async function forceDisableAgent(id: string, reason?: string): Promise<Agent>;
```

### 5.1 需要后端配合确认的接口

当前 WP2 后端已有注册、发现、审核接口，但「我的 Agent」列表建议补一个更合理的接口：

```http
GET /api/v1/agents/my
```

原因：

- 当前旧前端使用 `/api/v1/owner/agents/user/:userId`。
- 新接口不应由前端在 URL 中传 `userId`。
- 后端应通过 token 识别当前用户。

如果后端短期未提供 `/api/v1/agents/my`，前端可以临时保留旧 Owner 列表接口，但需要在代码中标注为兼容路径。

### 5.2 Agent Card 预校验建议

建议后端后续补充：

```http
POST /api/v1/agents/validate-card
```

用于前端在正式提交前预览 Card 解析结果。短期如果后端未实现，前端至少应提供 JSON 格式校验和必填字段检查。

---

## 6. 页面改造方案

### 6.1 `AgentManagement.tsx` 升级

路径：

```text
frontend/src/pages/AgentManagement.tsx
```

定位：

Owner 的「我的 Agent」控制台。

主要变化：

1. 列表展示从旧状态升级为 WP2 状态。
2. 创建 Agent 的表单抽离为 `CreateAgentForm.tsx`。
3. 注册后展示「待审核」状态。
4. 保留旧 API Key、Webhook、支付等 Owner 管理能力。

列表字段建议：

| 字段 | 说明 |
| --- | --- |
| Agent 名称 | `name` |
| 类型 | `agentType`: 平台托管 / 外部自托管 |
| 审核状态 | `approvalStatus` |
| 运行状态 | `runtimeStatus` |
| 能力标签 | `capabilities` / `tags` |
| 定价 | `pricingModel` + `basePrice` + `currency` |
| 创建时间 | `createdAt` |
| 操作 | 查看详情、启用、禁用、健康检查 |

注册成功提示：

```text
Agent 已提交审核，当前状态：待审核。管理员审核通过后，该 Agent 才会进入智能体广场。
```

### 6.2 `CreateAgentForm.tsx` 新增

路径：

```text
frontend/src/components/agents/CreateAgentForm.tsx
```

表单使用两个模式：

#### 模式一：平台托管 Agent

字段：

| 字段 | 后端字段 | 必填 |
| --- | --- | --- |
| 名称 | `name` | 是 |
| 描述 | `description` | 是 |
| 技能 | `skills` / `capabilities` | 是 |
| 业务领域 | `domains` | 是 |
| 自定义标签 | `tags` | 否 |
| Endpoint URL | `endpointUrl` | 视业务而定 |
| Health URL | `healthUrl` | 否 |
| Auth Type | `authType` | 否 |
| 定价模式 | `pricingModel` | 是 |
| 基础价格 | `basePrice` | 否 |
| 币种 | `currency` | 否，默认 CNY |
| 联系邮箱 | `contactEmail` | 否 |

提交接口：

```http
POST /api/v1/agents/register
```

#### 模式二：外部自托管 Agent

字段：

| 字段 | 后端字段 | 必填 |
| --- | --- | --- |
| Card URL | `cardUrl` | 与 `cardJson` 二选一 |
| Card JSON | `cardJson` | 与 `cardUrl` 二选一 |
| 联系邮箱 | `contactEmail` | 否 |
| 补充说明 | `metadata` | 否 |

提交接口：

```http
POST /api/v1/agents/register-external
```

交互要求：

1. `cardUrl` 和 `cardJson` 必须至少填写一个。
2. 粘贴 `cardJson` 时前端先校验 JSON 格式。
3. 提交前展示 Agent Card 预览，包括名称、描述、能力、endpoint、healthUrl、authType。
4. 提交成功后关闭弹窗并刷新「我的 Agent」列表。
5. 提示审核状态，不提示已上线。

### 6.3 `AgentDetail.tsx` 升级

路径：

```text
frontend/src/pages/AgentDetail.tsx
```

定位：

Owner 私有详情页。

新增展示区块：

| 区块 | 内容 |
| --- | --- |
| 基础信息 | 名称、描述、版本、创建时间、更新时间 |
| 注册信息 | Agent 类型、Card URL、Endpoint URL、Health URL、Auth Type |
| 审核状态 | `approvalStatus`、审核时间、驳回原因或审核备注 |
| 运行状态 | `runtimeStatus`、最近心跳时间、健康检查结果 |
| 能力与标签 | capabilities、skills、domains、custom tags |
| 定价信息 | pricingModel、basePrice、currency |
| Agent Card | 当前 Card 摘要、Card JSON 查看入口 |
| 私有管理 | API Key、Webhook、支付、任务、启用/禁用 |

注意：

- Owner 私有详情页可以展示 API Key 管理区域。
- 公开详情页不能复用这些私有区域。

### 6.4 `AgentMarket.tsx` 新增

路径：

```text
frontend/src/pages/AgentMarket.tsx
```

路由：

```text
/agents
```

定位：

公开智能体广场，只展示审核通过的 Agent。

调用接口：

```http
GET /api/v1/agents/discover
GET /api/v1/agents/tags
```

筛选能力：

| 筛选项 | 参数建议 |
| --- | --- |
| 关键词 | `q` |
| 技能 | `skills` |
| 领域 | `domains` |
| 标签 | `tags` |
| 运行状态 | `runtimeStatus` |
| 价格类型 | `pricingModel` |
| 分页 | `page` / `pageSize` |

展示要求：

1. 默认只展示 `approvalStatus = approved` 的 Agent。
2. 若后端不支持排序，不在 UI 上承诺复杂排序；可以先保留综合排序或隐藏排序控件。
3. 支持 loading、empty、error 三种状态。
4. 点击卡片进入公开详情页 `/agents/:id`。
5. 不展示 API Key、Owner 手机号、Webhook 投递记录等私有信息。

### 6.5 `AgentPublicDetail.tsx` 新增

路径：

```text
frontend/src/pages/AgentPublicDetail.tsx
```

路由：

```text
/agents/:id
```

展示内容：

| 区块 | 内容 |
| --- | --- |
| 基础信息 | 名称、描述、版本、信誉分 |
| 状态 | 运行状态、是否可用 |
| 能力 | capabilities、skills、domains、tags |
| 定价 | pricingModel、basePrice、currency |
| 接入信息 | 公开可见的 endpoint/card 信息 |
| 使用入口 | 后续任务发布或调用入口 |

安全要求：

1. 不展示 API Key。
2. 不展示 credential、secret、内部 token。
3. 不展示 Owner 私有联系方式，除非后端明确返回公开联系字段。
4. 已驳回、待审核、禁用 Agent 不应进入公开详情；若访问则显示不可用或 404。

### 6.6 `AdminAgents.tsx` 新增

路径：

```text
frontend/src/pages/AdminAgents.tsx
```

路由：

```text
/admin/agents
```

调用接口：

```http
GET /api/v1/admin/agents
GET /api/v1/admin/agents/pending
POST /api/v1/admin/agents/:id/approve
POST /api/v1/admin/agents/:id/reject
POST /api/v1/admin/agents/:id/force-disable
```

页面结构：

1. 状态 Tab：
   - 待审核
   - 已通过
   - 已驳回
   - 已禁用
   - 全部
2. Agent 审核列表：
   - 名称
   - Owner
   - Agent 类型
   - Card URL
   - Endpoint URL
   - 技能/领域/标签
   - 审核状态
   - 运行状态
   - 创建时间
3. 操作：
   - 查看详情
   - 通过
   - 驳回
   - 强制禁用

交互要求：

1. 驳回必须填写原因。
2. 通过前展示确认弹窗。
3. 操作成功后刷新当前列表。
4. 管理后台入口只对管理员角色可见。
5. 非管理员访问应跳转或展示无权限。

---

## 7. 新增组件

建议新增目录：

```text
frontend/src/components/agents/
```

| 组件 | 用途 | 使用场景 |
| --- | --- | --- |
| `AgentCard.tsx` | Agent 卡片，展示名称、描述、评分、技能、定价、状态 | 智能体广场、搜索结果 |
| `AgentSkillTags.tsx` | 技能、领域、标签渲染与筛选 | 广场、详情、管理页 |
| `AgentStatusBadge.tsx` | 审核状态和运行状态徽标 | 多页面复用 |
| `CreateAgentForm.tsx` | Agent 注册表单 | 我的 Agent 页面、注册弹窗 |
| `AgentCardPreview.tsx` | Agent Card 解析预览 | 外部 Agent 注册 |
| `AdminAgentReviewCard.tsx` | 审核后台列表项 | 管理员审核页 |

### 7.1 状态徽标映射

审核状态：

| 值 | 文案 | 样式建议 |
| --- | --- | --- |
| `pending_review` | 待审核 | 黄色/警示 |
| `approved` | 已通过 | 绿色/成功 |
| `rejected` | 已驳回 | 红色/失败 |

运行状态：

| 值 | 文案 | 样式建议 |
| --- | --- | --- |
| `online` | 在线 | 绿色 |
| `offline` | 离线 | 灰色 |
| `degraded` | 降级 | 橙色 |
| `timeout` | 超时 | 红色 |

---

## 8. 路由与导航调整

修改文件：

```text
frontend/src/App.tsx
frontend/src/components/layout/MainLayout.tsx
```

新增路由：

```tsx
<Route path="agents" element={<AgentMarket />} />
<Route path="agents/:id" element={<AgentPublicDetail />} />
<Route path="admin/agents" element={<AdminAgents />} />
```

保留 Owner 路由：

```tsx
<Route path="owner/agents" element={<AgentManagement />} />
<Route path="owner/agents/:id" element={<AgentDetail />} />
```

导航建议：

| 入口 | 可见角色 | 路径 |
| --- | --- | --- |
| 智能体广场 | 所有已登录用户，后续可开放游客 | `/agents` |
| 我的 Agent | 已登录用户 | `/owner/agents` |
| Agent 审核 | 管理员 | `/admin/agents` |

---

## 9. 与 `agent_credentials` 的前端关系

`agent_credentials` 主要影响 API Key / Credential 管理区域，不直接影响公开注册页。但 Owner 私有详情页中的 API Key 区域后续需要兼容新表结构。

建议 API Key 列表展示字段：

| 字段 | 说明 |
| --- | --- |
| `keyId` | 对外显示的 key 标识 |
| `scopes` | 权限范围 |
| `status` | active / revoked / expired |
| `expiresAt` | 过期时间 |
| `createdAt` | 创建时间 |
| `revokedAt` | 撤销时间 |

短期兼容策略：

1. 前端继续调用现有 API Key 接口。
2. 后端在接口返回中逐步补充 `keyId`、`scopes`、`status`、`expiresAt`。
3. 前端不要依赖数据库表名，只依赖 API 返回字段。

---

## 10. 实施任务拆分

### Day 1: 基础类型、API 封装、注册表单

| # | 任务 | 文件 | 预计 |
| --- | --- | --- | --- |
| 1 | 新增 Agent 类型定义 | `frontend/src/types/agent.ts` | 0.5h |
| 2 | 新增 Agent API client | `frontend/src/api/agentsApi.ts` | 1h |
| 3 | 新增 `AgentStatusBadge`、`AgentSkillTags` | `frontend/src/components/agents/` | 1h |
| 4 | 新增 `CreateAgentForm`，支持两种注册模式 | `frontend/src/components/agents/CreateAgentForm.tsx` | 2.5h |
| 5 | 改造 `AgentManagement` 列表与注册入口 | `frontend/src/pages/AgentManagement.tsx` | 2h |

### Day 2: 详情页、市场页、审核后台

| # | 任务 | 文件 | 预计 |
| --- | --- | --- | --- |
| 6 | 升级 Owner Agent 详情页 | `frontend/src/pages/AgentDetail.tsx` | 2h |
| 7 | 新增智能体广场 | `frontend/src/pages/AgentMarket.tsx` | 2.5h |
| 8 | 新增公开 Agent 详情页 | `frontend/src/pages/AgentPublicDetail.tsx` | 1.5h |
| 9 | 新增审核后台 | `frontend/src/pages/AdminAgents.tsx` | 2h |
| 10 | 更新路由和导航 | `App.tsx`、`MainLayout.tsx` | 0.5h |

### Day 3: 联调与验收

| # | 任务 | 内容 | 预计 |
| --- | --- | --- | --- |
| 11 | 注册流程联调 | 平台托管、Card URL、Card JSON | 1.5h |
| 12 | 审核流程联调 | 待审核、通过、驳回、禁用 | 1.5h |
| 13 | 发现页联调 | 搜索、筛选、分页、公开详情 | 1h |
| 14 | 权限与异常测试 | 未登录、非管理员、接口错误、空状态 | 1h |

---

## 11. 验收标准

### 11.1 用户注册流程

- [ ] 用户可以在 `/owner/agents` 打开 Agent 注册入口。
- [ ] 用户可以选择「平台托管 Agent」并提交注册。
- [ ] 用户可以选择「外部自托管 Agent」并通过 `cardUrl` 注册。
- [ ] 用户可以通过粘贴 `cardJson` 注册外部 Agent。
- [ ] 注册成功后列表中出现新 Agent。
- [ ] 新 Agent 默认展示为「待审核」。
- [ ] 注册成功提示不出现「已上线」误导文案。

### 11.2 Owner 管理流程

- [ ] `/owner/agents` 展示 Agent 类型、审核状态、运行状态。
- [ ] `/owner/agents/:id` 展示 Agent Card、能力、标签、定价、endpoint、healthUrl。
- [ ] Owner 私有详情页继续保留 API Key、Webhook、支付等已有管理能力。
- [ ] API Key 区域可以兼容 `keyId`、`scopes`、`status`、`expiresAt` 字段。

### 11.3 管理员审核流程

- [ ] 管理员可以访问 `/admin/agents`。
- [ ] 非管理员不能访问审核后台。
- [ ] 审核后台可以查看待审核 Agent。
- [ ] 管理员可以通过 Agent。
- [ ] 管理员可以驳回 Agent，并填写驳回原因。
- [ ] 管理员可以强制禁用 Agent。
- [ ] 审核操作后列表状态立即刷新。

### 11.4 智能体广场流程

- [ ] `/agents` 可以展示已审核通过的 Agent。
- [ ] 待审核 Agent 不出现在广场。
- [ ] 已驳回 Agent 不出现在广场。
- [ ] 已禁用 Agent 不出现在广场。
- [ ] 用户可以按关键词搜索 Agent。
- [ ] 用户可以按技能、领域、标签筛选 Agent。
- [ ] 点击卡片可以进入 `/agents/:id` 公开详情页。
- [ ] 公开详情页不展示 API Key、secret、credential、Owner 私有配置。

### 11.5 异常与体验

- [ ] 接口 loading 状态明确。
- [ ] 接口失败时展示可理解错误信息。
- [ ] 无数据时展示空状态。
- [ ] `cardJson` 格式错误时阻止提交并提示错误。
- [ ] `cardUrl` 和 `cardJson` 至少填写一个。
- [ ] 表单必填项有校验。
- [ ] 页面在移动端和桌面端均无明显布局错乱。

---

## 12. 联调测试建议

建议按以下顺序完成前后端联调：

1. 登录普通用户。
2. 在 `/owner/agents` 注册平台托管 Agent。
3. 确认 Agent 出现在「我的 Agent」，状态为 `pending_review`。
4. 注册外部自托管 Agent，分别测试 `cardUrl` 和 `cardJson`。
5. 登录管理员。
6. 进入 `/admin/agents`，确认待审核 Agent 可见。
7. 审核通过其中一个 Agent。
8. 回到 `/agents`，确认通过审核的 Agent 出现在智能体广场。
9. 驳回另一个 Agent，确认它不会出现在智能体广场。
10. 访问 `/agents/:id`，确认公开详情不暴露私有信息。
11. 访问 `/owner/agents/:id`，确认 Owner 私有详情仍可管理 API Key、Webhook 等能力。

---

## 13. 风险与依赖

| 风险 | 影响 | 建议 |
| --- | --- | --- |
| 后端缺少 `/api/v1/agents/my` | 我的 Agent 列表仍依赖旧接口 | 短期兼容旧接口，后端补新接口后切换 |
| 后端缺少 Agent Card 预校验接口 | 外部注册体验不够直观 | 前端先做 JSON 校验，后端后续补 `validate-card` |
| 公开详情和 Owner 详情混用 | 可能暴露私有信息 | 必须拆分 `AgentPublicDetail.tsx` |
| 后端排序能力不足 | 广场排序 UI 与实际不一致 | 前端只展示后端已支持的筛选和排序 |
| API Key 表迁移到 `agent_credentials` | API Key UI 字段可能变化 | 前端只依赖 API response，不依赖表名 |

---

## 14. 最终落地结论

WP2 前端改造应以「Agent 注册 + 审核 + 公开发现」闭环为核心，而不是只改造旧 Owner Agent 表单。

最终应落地以下能力：

1. 用户可以在页面上真实注册 Agent。
2. 注册支持平台托管和外部 Agent Card 两种模式。
3. 注册后的 Agent 明确进入审核状态。
4. 管理员可以在后台审核、驳回、禁用 Agent。
5. 审核通过的 Agent 自动进入智能体广场。
6. 公开详情页与 Owner 私有详情页隔离，避免敏感信息泄露。
7. 前端 API、类型、组件形成可复用结构，为后续 WP3/WP4 的任务编排、调用、结算继续复用。
