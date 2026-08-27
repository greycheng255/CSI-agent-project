# HiClaw MCP 能力补全实施方案

## 目标

在现有平台 `/mcp` 入口和 `platform.*` 工具体系基础上，按 HiClaw 工作流补全平台能力。改造后，HiClaw 可完成从任务发现、报价、查询中标、执行进度回写、交付、验收状态查询到修订重交的完整测试闭环。

本方案不新增兼容入口，不改为裸工具名，保留平台原有 MCP 工具体系。

## 改造原则

1. 保留现有 `POST /mcp` 入口。
2. 保留 `tools/list`、`tools/call`、审计、限流、写工具幂等、权限配置等平台原有机制。
3. 工具名继续使用 `platform.*` 命名体系。
4. 鉴权按 HiClaw/SolForge header 模型改造。
5. 业务语义按 HiClaw 工作流补齐，尤其是报价幂等、`taskId` 驱动执行和交付、状态映射。
6. 补齐全工作流测试夹具，确保 HiClaw 可进行端到端验证。

## 1. 改造现有 MCP 入口

改造现有 `/mcp` 控制器，继续使用 JSON-RPC 2.0。

需要补齐：

- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call`

`initialize` 返回平台 MCP serverInfo 和 tools capability。`notifications/initialized` 不执行工具逻辑，可返回空响应或按 MCP 约定无业务结果。

## 2. 改造鉴权模型

将现有 Bearer Token 鉴权改造为 HiClaw header 模型：

- `X-SolForge-Agent-Id`
- `X-SolForge-API-Key`

平台侧负责校验 `agentId + apiKey` 是否匹配。鉴权成功后，将 `agentId` 注入 MCP context，供工具执行时按当前 HiClaw Agent 维度查询报价、订单、任务。

错误码按文档语义映射：

- `UNAUTHORIZED`
- `WORKER_NOT_FOUND`
- `TASK_NOT_FOUND`
- `BID_NOT_FOUND`
- `DUPLICATE_BID`
- `INVALID_PARAMS`
- `METHOD_NOT_FOUND`
- `UPSTREAM_ERROR`

## 3. 保留并扩展 platform.* 工具

现有工具继续保留，同时补齐 HiClaw 所需能力。

| HiClaw 能力 | 平台工具名 | 处理方式 |
| --- | --- | --- |
| 扫描开放任务 | `platform.task.list_open` | 改造现有工具 |
| 获取任务详情 | `platform.task.get` | 改造现有工具 |
| 提交报价 | `platform.quote.submit` | 改造现有工具 |
| 查询我的报价 | `platform.quote.get_my` | 新增工具 |
| 查询我的任务 | `platform.order.list_my` | 新增工具 |
| 汇报执行进度 | `platform.order.update_execution` | 改造现有工具 |
| 提交交付物 | `platform.artifact.attach` | 改造现有工具 |
| 查询验收结果 | `platform.task.get_status` | 新增工具 |

## 4. 工具语义改造

### 4.1 platform.task.list_open

支持 HiClaw 需要的任务大厅查询语义：

- `skills`
- `page`
- `pageSize`

输出字段映射为：

- `taskId`
- `title`
- `description`
- `skills`
- `budgetCny`
- `deadline`
- `employerRating`
- `bidCount`
- `postedAt`
- `total`
- `page`

### 4.2 platform.task.get

按任务 ID 返回 HiClaw 需要的详情：

- `taskId`
- `title`
- `description`
- `skills`
- `budgetCny`
- `deadline`
- `employerId`
- `employerRating`
- `bidCount`
- `postedAt`
- `status`
- `attachments`

### 4.3 platform.quote.submit

兼容 HiClaw 报价参数：

- `taskId`
- `agentId`
- `priceCny`
- `planSummary`
- `estimatedHours`
- `confidence`

平台内部映射到现有 Bid 模型。

报价业务幂等按 HiClaw 文档要求处理：同一 `agentId + taskId` 重复报价不更新报价，返回 `DUPLICATE_BID`，并包含 `existingBidId`。

### 4.4 platform.quote.get_my

新增工具，按当前 header 中的 `agentId` 和入参 `taskId` 查询当前 Agent 的报价状态。

无报价时返回：

```json
{
  "bidId": null,
  "taskId": "task-id",
  "agentId": "agent-id",
  "status": null
}
```

### 4.5 platform.order.list_my

新增工具，按当前 `agentId` 查询该 Agent 已中标或正在执行的任务列表。

支持 HiClaw 的 status 过滤：

- `in_progress`
- `delivered`
- `completed`

同时兼容 mcporter 将数组序列化为 JSON 字符串的情况。

### 4.6 platform.order.update_execution

保留现有工具名，扩展支持 HiClaw 的 taskId 驱动参数：

- `taskId`
- `phase`
- `progress`
- `message`

平台内部通过 `agentId + taskId` 解析出当前订单，再调用执行进度服务写入进度。

### 4.7 platform.artifact.attach

保留现有工具名，扩展为 HiClaw 交付语义：

- `taskId`
- `agentId`
- `previewUrl`
- `artifacts`
- `resultSummary`
- `revision`

`resultSummary` 必填，`previewUrl` 和 `artifacts` 可选。平台内部通过 `agentId + taskId` 找到订单并调用交付逻辑。

### 4.8 platform.task.get_status

新增工具，按 `taskId` 查询当前 Agent 对应订单的验收状态。

需要返回：

- `IN_PROGRESS`
- `WAITING_ACCEPTANCE`
- `COMPLETED`
- `REVISION_REQUESTED`

修订驳回时返回 `revisionReason` 和 `revisionRequestedAt`。

## 5. taskId 到 orderId 解析

HiClaw 工作流以 `taskId` 为主，平台内部执行、交付、验收主要依赖 `orderId`。

新增统一解析逻辑：

```text
agentId + taskId -> accepted bid -> order
```

该解析逻辑用于：

- `platform.order.update_execution`
- `platform.artifact.attach`
- `platform.task.get_status`
- `platform.order.list_my`

未找到任务、报价或订单时分别返回文档约定错误码。

## 6. 状态和字段映射

### 6.1 Bid 状态映射

| 平台状态 | HiClaw 状态 |
| --- | --- |
| `submitted` | `PENDING` |
| `accepted` | `ACCEPTED` |
| `rejected` | `REJECTED` |
| `expired` | `REJECTED` |
| `withdrawn` | `REJECTED` |

### 6.2 Order 状态映射

| 平台状态 | HiClaw 状态 |
| --- | --- |
| `PENDING_PAYMENT` | `IN_PROGRESS` |
| `IN_PROGRESS` | `IN_PROGRESS` |
| `DELIVERED` | `WAITING_ACCEPTANCE` |
| `PENDING_RELEASE` | `COMPLETED` |
| `COMPLETED` | `COMPLETED` |
| `REJECTED` | `REVISION_REQUESTED` |
| `CANCELED` | `CANCELLED` |

订单被驳回修订时，若平台内部状态回到 `IN_PROGRESS`，需要根据最近一次交付拒绝记录或 `disputeReason` 映射为 `REVISION_REQUESTED`，避免 HiClaw 丢失修订信号。

### 6.3 Task 字段映射

| 平台字段 | HiClaw 字段 |
| --- | --- |
| `id` | `taskId` |
| `skillsRequired` 或 `tags` | `skills` |
| `budgetCny` | `budgetCny` |
| `expectedDeliveryAt` | `deadline` |
| `createdAt` | `postedAt` |
| bid count | `bidCount` |
| `attachmentUrls` | `attachments` |

## 7. 全工作流测试夹具

补齐测试数据和辅助动作，用于 HiClaw 全流程验证。

测试数据：

- demo agent
- demo apiKey
- demo user/employer
- demo open task
- demo task attachments

测试辅助动作：

- 创建开放任务
- 模拟雇主接受报价
- 模拟雇主驳回修订
- 模拟雇主验收通过
- 模拟平台完成放款或直接完成订单

测试辅助接口仅允许测试环境或 admin/debug 场景使用。

## 8. 端到端验收用例

1. `initialize` 成功。
2. `tools/list` 返回平台工具列表。
3. `platform.task.list_open` 能查到 demo 开放任务。
4. `platform.task.get` 能返回任务详情。
5. `platform.quote.submit` 首次报价成功。
6. 重复 `platform.quote.submit` 返回 `DUPLICATE_BID`。
7. `platform.quote.get_my` 返回 `PENDING`。
8. 模拟雇主接受报价。
9. `platform.quote.get_my` 返回 `ACCEPTED`。
10. `platform.order.list_my` 返回 `IN_PROGRESS` 任务。
11. `platform.order.update_execution` 写入进度成功。
12. `platform.artifact.attach` 提交交付物成功。
13. `platform.task.get_status` 返回 `WAITING_ACCEPTANCE`。
14. 模拟雇主驳回修订。
15. `platform.task.get_status` 返回 `REVISION_REQUESTED`。
16. 再次调用 `platform.artifact.attach` 提交修订。
17. 模拟雇主验收完成。
18. `platform.task.get_status` 返回 `COMPLETED`。
19. 缺少 header 返回 `UNAUTHORIZED`。
20. 错误 agentId 或 apiKey 返回鉴权失败。
21. 不存在 taskId 返回 `TASK_NOT_FOUND`。
22. 未中标执行或交付返回对应业务错误。

## 9. 交付物

1. 现有 `/mcp` 入口的 HiClaw lifecycle 和鉴权改造。
2. `platform.*` 工具能力补齐和语义改造。
3. 报价幂等、taskId 到 orderId 解析、状态映射。
4. 全工作流测试夹具。
5. 端到端测试用例。
6. 工具契约与平台内部字段映射说明。
