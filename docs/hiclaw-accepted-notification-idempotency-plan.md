# HiClaw 中标通知幂等防重方案

## 背景

HiClaw 调试过程中发现，Agent loop 会重复从平台 MCP 接口获取中标任务，并反复发送“报价中标通知”DM。

截图表现：

- 同一个 `taskId` 多次出现“报价中标通知”。
- 每次提示用户执行 `hiclaw-taskflow ack --sync <taskId>`。
- 只要 `platform.order.list_my` 持续返回已中标任务，HiClaw loop 就会再次发送 DM。

## 问题定位

当前问题不是报价写入幂等失效，而是“中标通知事件”没有消费状态。

现有链路：

1. 雇主选标后，平台创建订单，并把报价置为 `BidStatus.ACCEPTED`。
2. HiClaw 通过 MCP 轮询 `platform.order.list_my`。
3. `platform.order.list_my` 每次都会返回当前 Agent 的订单，并带上 `bidStatus: ACCEPTED`。
4. 平台现有 `idempotency_key` 只保护写工具，例如报价、进度回传、交付提交。
5. `platform.order.list_my` 是读工具，不走写工具幂等。
6. HiClaw agent loop 把“读到 `ACCEPTED`”当成“新中标事件”，所以轮询一次就可能发一次 DM。

根因：

`ACCEPTED` 是订单/报价事实状态，不是一次性事件。平台当前没有记录“这个 Agent 对这个任务的中标通知是否已经投递/确认”，导致读取状态时无法区分“第一次看到”还是“重复轮询看到”。

## 改造目标

1. 保持 `platform.*` 工具体系不变。
2. 保留 `platform.order.list_my` 的任务列表查询能力。
3. 增加平台侧持久化防重 guard，确保同一个 Agent、同一个任务、同一个中标事件最多触发一次通知。
4. 支持 HiClaw `hiclaw-taskflow ack --sync <taskId>` 语义，由平台记录 ACK 状态。
5. 不影响后续 `platform.order.update_execution`、`platform.artifact.attach`、`platform.task.get_status` 工作流。

## 推荐方案

### 1. 新增中标通知事件表

新增实体和表，例如 `mcp_agent_order_events`。

建议字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 事件 ID |
| `agent_id` | 平台 Agent ID |
| `agent_external_id` | Agent externalId 快照，可选 |
| `task_id` | 平台任务 ID |
| `order_id` | 平台订单 ID |
| `bid_id` | 中标报价 ID |
| `event_type` | 固定为 `BID_ACCEPTED`，后续可扩展 |
| `status` | `PENDING` / `DELIVERED` / `ACKED` |
| `delivery_count` | 投递次数 |
| `first_delivered_at` | 首次投递时间 |
| `last_delivered_at` | 最近投递时间 |
| `acked_at` | HiClaw 确认时间 |
| `last_request_id` | 最近 MCP request_id |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

唯一约束：

```sql
UNIQUE(agent_id, task_id, order_id, event_type)
```

作用：

- 保证同一中标事件只创建一次。
- 多次轮询不会生成多个待通知事件。
- 后续 ACK 可以精确落到同一个事件。

### 2. 改造 `platform.order.list_my`

`list_my` 仍返回当前 Agent 已接/执行中的任务，但不要让 `bidStatus: ACCEPTED` 承担通知事件语义。

建议每个任务新增字段：

```json
{
  "taskId": "9931ab7b-48c6-4f09-a39f-82039107fa94",
  "orderId": "order-id",
  "status": "IN_PROGRESS",
  "bidStatus": "ACCEPTED",
  "acceptanceEventId": "event-id",
  "acceptanceNoticeStatus": "DELIVERED",
  "shouldNotifyAcceptance": true,
  "requiresAck": true,
  "acceptedAt": "2026-06-22T09:20:00.000Z"
}
```

推荐语义：

| 事件状态 | `shouldNotifyAcceptance` | 说明 |
| --- | --- | --- |
| `PENDING` | `true` | 首次发现中标事件，允许 HiClaw 发一次 DM |
| `DELIVERED` | `false` | 已向 HiClaw 投递过，不应重复发 DM |
| `ACKED` | `false` | HiClaw 已确认，不应重复发 DM |

首轮可简化为：

- 第一次 `list_my` 返回时，如果事件不存在则创建事件，并返回 `shouldNotifyAcceptance: true`。
- 同时将事件置为 `DELIVERED`，记录 `first_delivered_at`、`last_delivered_at`、`delivery_count=1`。
- 后续 `list_my` 再次看到该事件时返回 `shouldNotifyAcceptance: false`。

这样即使 HiClaw 未及时 ACK，也不会重复 DM。

### 3. 新增 ACK 工具

新增 MCP 工具：

```text
platform.order.ack_acceptance
```

工具类型：写工具。

入参建议：

```json
{
  "taskId": "9931ab7b-48c6-4f09-a39f-82039107fa94",
  "order_id": "order-id",
  "acceptance_event_id": "event-id",
  "request_id": "req-001",
  "idempotency_key": "hiclaw-ack-9931ab7b"
}
```

兼容参数：

- `taskId` / `task_id`
- `orderId` / `order_id`
- `acceptanceEventId` / `acceptance_event_id`

处理规则：

1. 必须通过 `X-SolForge-Agent-Id` + `X-SolForge-API-Key` 鉴权识别当前 Agent。
2. 如果传入 `acceptance_event_id`，优先按事件 ID 查询。
3. 如果只传 `taskId`，按 `agentId + taskId + event_type=BID_ACCEPTED` 查询。
4. 事件不存在时，可按当前 Agent 的中标订单补建事件，再置为 `ACKED`。
5. 重复 ACK 返回成功，保持幂等。

返回建议：

```json
{
  "accepted": true,
  "taskId": "9931ab7b-48c6-4f09-a39f-82039107fa94",
  "orderId": "order-id",
  "acceptanceEventId": "event-id",
  "noticeStatus": "ACKED",
  "ackedAt": "2026-06-22T12:00:00.000Z"
}
```

### 4. HiClaw 侧调用建议

HiClaw loop 应改为只在下面条件成立时发送中标 DM：

```text
bidStatus == ACCEPTED && shouldNotifyAcceptance == true
```

发送 DM 后调用：

```text
platform.order.ack_acceptance
```

如果用户执行：

```bash
hiclaw-taskflow ack --sync <taskId>
```

HiClaw 也应调用 `platform.order.ack_acceptance`，把平台事件置为 `ACKED`。

## 为什么不只依赖 `idempotency_key`

`idempotency_key` 适合保护写请求，例如：

- `platform.quote.submit`
- `platform.order.update_execution`
- `platform.artifact.attach`

但本问题发生在读工具 `platform.order.list_my` 上。读接口每次返回同一个事实状态是正常行为，不能通过写请求幂等解决。

因此必须增加“事件消费状态”，让平台知道某个中标事件是否已经投递过。

## 测试计划

### 单元测试

在 `backend/src/mcp/tools/platform.tools.spec.ts` 补充：

1. Agent 中标后，第一次调用 `platform.order.list_my`：
   - 返回任务。
   - `bidStatus=ACCEPTED`。
   - `shouldNotifyAcceptance=true`。
   - `acceptanceNoticeStatus=DELIVERED`。
2. 第二次调用 `platform.order.list_my`：
   - 仍返回任务。
   - `bidStatus=ACCEPTED`。
   - `shouldNotifyAcceptance=false`。
3. 调用 `platform.order.ack_acceptance`：
   - 返回 `noticeStatus=ACKED`。
4. 重复调用 `platform.order.ack_acceptance`：
   - 返回成功。
   - 不重复创建事件。
5. ACK 后再次调用 `platform.order.list_my`：
   - `shouldNotifyAcceptance=false`。
   - `acceptanceNoticeStatus=ACKED`。
6. 不影响后续：
   - `platform.order.update_execution`
   - `platform.artifact.attach`
   - `platform.task.get_status`

### 回归测试

用 HiClaw agent loop 验证：

1. 首次轮询到中标任务，只发一次 DM。
2. 后续连续轮询 5 次，不再重复发 DM。
3. 执行 `hiclaw-taskflow ack --sync <taskId>` 后，平台事件状态变为 `ACKED`。
4. ACK 后继续轮询，不再重复发 DM。
5. 同一个 Agent 中多个任务分别中标时，每个任务各自只通知一次。

## 涉及文件预估

后端：

- `backend/src/mcp/tools/platform.tools.ts`
- `backend/src/mcp/tools/platform.tools.spec.ts`
- `backend/src/mcp/mcp.module.ts`
- `backend/src/app.module.ts`
- 新增 `backend/src/mcp/entities/mcp-agent-order-event.entity.ts`

如当前环境开启 `DB_SYNC=true`，实体注册后可自动建表；否则需要补充数据库迁移或手动 SQL。

## 最小落地顺序

1. 新增事件实体和唯一索引。
2. 注册实体到 MCP module / app module。
3. 在 `platform.order.list_my` 中补事件创建、投递标记和返回字段。
4. 新增 `platform.order.ack_acceptance` 工具。
5. 补单元测试和 HiClaw 全流程回归夹具。
6. 更新 HiClaw MCP 对接说明文档，明确 `shouldNotifyAcceptance` 和 ACK 工具语义。
