# HiClaw Agent Loop 事件消费防重方案

## 1. 问题背景

HiClaw Agent Loop 会持续轮询平台 MCP：

```text
任务大厅扫描
任务匹配
报价提交
报价状态查询
订单状态查询
执行进度回传
交付提交
修订、验收、完成状态查询
```

当前重复通知问题的本质是：HiClaw 把平台的“事实状态”当成“一次性事件”。

例如：

```text
platform.order.list_my 每次都返回 bidStatus=ACCEPTED
HiClaw 每次轮询都认为这是新的中标事件
于是重复发送中标通知 DM
```

同类问题不只会发生在中标节点，也会发生在：

```text
任务推荐
订单启动
修订请求
验收通过
订单完成
取消、退款、仲裁
```

因此不能只修 `BID_ACCEPTED`，需要统一引入事件消费模型。

## 2. 设计目标

1. 平台事实状态可以反复返回。
2. HiClaw 副作用动作只能由一次性事件触发。
3. 所有需要通知、启动、归档、停止、重试的节点统一走事件消费。
4. HiClaw Agent Loop 只处理 `shouldAct=true` 的事件。
5. 消费完成后统一调用 `platform.event.ack`。
6. 不再增加单点确认工具，例如 `platform.order.ack_acceptance`。

## 3. 核心原则

事实状态不是事件。

```text
bidStatus=ACCEPTED
orderStatus=IN_PROGRESS
taskStatus=REVISION_REQUESTED
orderStatus=COMPLETED
```

事件才是动作信号。

```text
eventType=BID_ACCEPTED
shouldAct=true
```

HiClaw 新规则：

```text
不再根据事实状态直接发消息、启动任务、归档任务
只根据事件 shouldAct=true 执行动作
动作完成后调用 platform.event.ack
```

## 4. 数据模型

新增通用事件表：

```text
mcp_agent_task_events
```

字段建议：

```text
id
agent_id
agent_external_id
task_id
order_id nullable
bid_id nullable
delivery_id nullable
arbitration_id nullable
event_type
event_key
status
delivery_count
first_delivered_at
last_delivered_at
acked_at
expired_at
last_request_id
payload_json
created_at
updated_at
```

状态枚举：

```text
PENDING     事件已生成，尚未投递
DELIVERED   已投递给 HiClaw，本轮可执行
ACKED       HiClaw 已确认消费
EXPIRED     事件已过期，不再处理
```

唯一约束：

```sql
UNIQUE(agent_id, event_type, event_key)
```

`event_key` 用于标识“具体哪一次事件”，避免同类事件误去重。

## 5. 事件类型

| event_type | 触发条件 | event_key | HiClaw 动作 |
| --- | --- | --- | --- |
| `TASK_RECOMMENDED` | 开放任务匹配到当前 Agent | `TASK_RECOMMENDED:{taskId}:{agentId}` | 提醒可报价或进入报价决策 |
| `BID_SUBMITTED` | 报价提交成功 | `BID_SUBMITTED:{taskId}:{bidId}` | 可选通知报价已提交 |
| `BID_ACCEPTED` | 报价中标且订单创建 | `BID_ACCEPTED:{taskId}:{orderId}` | 发送中标通知，准备执行 |
| `BID_REJECTED` | 报价被拒绝或过期 | `BID_REJECTED:{taskId}:{bidId}` | 通知未中标，停止跟踪报价 |
| `ORDER_STARTED` | 订单进入执行状态 | `ORDER_STARTED:{orderId}` | 初始化执行上下文，启动 worker |
| `ORDER_ACTION_REQUIRED` | 平台或雇主要求补充操作 | `ORDER_ACTION_REQUIRED:{orderId}:{actionId}` | 通知用户处理，暂停自动推进 |
| `REVISION_REQUESTED` | 交付被驳回 | `REVISION_REQUESTED:{orderId}:{deliveryId}` | 通知修订，重新进入修复流程 |
| `DELIVERY_ACCEPTED` | 交付验收通过 | `DELIVERY_ACCEPTED:{orderId}:{deliveryId}` | 通知验收通过，停止修订循环 |
| `ORDER_COMPLETED` | 订单完成 | `ORDER_COMPLETED:{orderId}` | 通知完成，归档任务，停止轮询 |
| `ORDER_CANCELLED` | 订单取消 | `ORDER_CANCELLED:{orderId}` | 停止执行，通知取消，归档 |
| `ORDER_REFUNDED` | 订单退款 | `ORDER_REFUNDED:{orderId}` | 停止执行，通知退款 |
| `DISPUTE_OPENED` | 仲裁或争议开启 | `DISPUTE_OPENED:{orderId}` | 暂停自动执行，等待人工介入 |
| `DISPUTE_RESOLVED` | 仲裁结束 | `DISPUTE_RESOLVED:{orderId}:{arbitrationId}` | 通知结果，继续或归档 |

重点：`REVISION_REQUESTED` 和 `DELIVERY_ACCEPTED` 必须带 `deliveryId`，因为一个订单可能多轮交付、多轮驳回。

## 6. MCP 工具设计

### 6.1 统一 ACK 工具

新增：

```text
platform.event.ack
```

这是唯一的事件确认入口。

入参：

```json
{
  "eventId": "event-001",
  "eventType": "BID_ACCEPTED",
  "eventKey": "BID_ACCEPTED:task-001:order-001",
  "taskId": "task-001",
  "orderId": "order-001",
  "idempotency_key": "hiclaw-event-ack-event-001"
}
```

返回：

```json
{
  "accepted": true,
  "eventId": "event-001",
  "eventType": "BID_ACCEPTED",
  "eventKey": "BID_ACCEPTED:task-001:order-001",
  "noticeStatus": "ACKED",
  "ackedAt": "2026-06-23T12:00:00.000Z"
}
```

处理规则：

```text
ACK 必须校验当前 Agent 身份
重复 ACK 返回成功
事件不存在时返回明确错误，不隐式创建未知事件
eventId 优先，其次 eventType + eventKey
```

### 6.2 统一事件查询工具

新增：

```text
platform.event.list_my
```

用于 HiClaw 独立拉取待处理事件。

入参：

```json
{
  "status": ["PENDING", "DELIVERED"],
  "limit": 50,
  "request_id": "req-001"
}
```

返回：

```json
{
  "events": [
    {
      "eventId": "event-001",
      "eventType": "BID_ACCEPTED",
      "eventKey": "BID_ACCEPTED:task-001:order-001",
      "taskId": "task-001",
      "orderId": "order-001",
      "noticeStatus": "DELIVERED",
      "shouldAct": true,
      "requiresAck": true,
      "payload": {}
    }
  ]
}
```

## 7. 读工具返回改造

现有读工具继续返回事实状态，同时附带事件信息。

涉及工具：

```text
platform.task.list_open
platform.quote.get_my
platform.order.list_my
platform.task.get_status
platform.event.list_my
```

统一事件结构：

```json
{
  "eventId": "event-001",
  "eventType": "BID_ACCEPTED",
  "eventKey": "BID_ACCEPTED:task-001:order-001",
  "noticeStatus": "DELIVERED",
  "shouldAct": true,
  "requiresAck": true,
  "payload": {}
}
```

`platform.order.list_my` 示例：

```json
{
  "tasks": [
    {
      "taskId": "task-001",
      "orderId": "order-001",
      "status": "IN_PROGRESS",
      "bidStatus": "ACCEPTED",
      "events": [
        {
          "eventId": "event-001",
          "eventType": "BID_ACCEPTED",
          "eventKey": "BID_ACCEPTED:task-001:order-001",
          "noticeStatus": "DELIVERED",
          "shouldAct": true,
          "requiresAck": true
        }
      ]
    }
  ]
}
```

后续轮询同一事件：

```json
{
  "eventType": "BID_ACCEPTED",
  "noticeStatus": "DELIVERED",
  "shouldAct": false,
  "requiresAck": true
}
```

ACK 后：

```json
{
  "eventType": "BID_ACCEPTED",
  "noticeStatus": "ACKED",
  "shouldAct": false,
  "requiresAck": false
}
```

## 8. 事件投递规则

当平台读工具发现某个事实状态满足事件条件时：

1. 生成 `event_type`。
2. 计算 `event_key`。
3. 根据唯一约束查找事件。
4. 如果不存在，创建 `PENDING` 事件。
5. 首次返回给 HiClaw 时，将状态推进为 `DELIVERED`。
6. 本次返回 `shouldAct=true`。
7. 后续轮询返回同一事件，但 `shouldAct=false`。
8. HiClaw ACK 后状态变为 `ACKED`。

关键点：

```text
shouldAct=true 只出现一次
事实状态可以无限次返回
```

## 9. HiClaw Agent Loop 改造

旧逻辑禁止：

```text
看到 bidStatus=ACCEPTED 就发中标通知
看到 IN_PROGRESS 就启动执行
看到 REVISION_REQUESTED 就发修订通知
看到 COMPLETED 就归档
```

新逻辑：

```ts
for (const task of tasks) {
  for (const event of task.events || []) {
    if (!event.shouldAct) continue;

    await handleEvent(event, task);

    await mcp.call('platform.event.ack', {
      eventId: event.eventId,
      eventType: event.eventType,
      eventKey: event.eventKey,
      taskId: task.taskId,
      orderId: task.orderId,
      idempotency_key: `hiclaw-event-ack-${event.eventId}`,
    });
  }
}
```

事件处理映射：

```text
TASK_RECOMMENDED      -> 报价决策或提醒
BID_ACCEPTED          -> 中标通知
ORDER_STARTED         -> 初始化执行
REVISION_REQUESTED    -> 修订通知和修复流程
DELIVERY_ACCEPTED     -> 验收通过通知
ORDER_COMPLETED       -> 归档
ORDER_CANCELLED       -> 停止执行并归档
ORDER_REFUNDED        -> 停止执行并通知
DISPUTE_OPENED        -> 暂停自动执行
DISPUTE_RESOLVED      -> 根据结果继续或归档
```

## 10. 与 idempotency_key 的边界

`idempotency_key` 继续用于写工具防重：

```text
platform.quote.submit
platform.order.update_execution
platform.artifact.attach
platform.event.ack
```

事件消费用于读状态触发副作用防重：

```text
platform.order.list_my
platform.task.get_status
platform.event.list_my
```

两者职责不同：

```text
idempotency_key 防止同一个写请求重复执行
event consumption 防止同一个事实状态重复触发副作用
```

## 11. 实施范围

后端新增：

```text
mcp_agent_task_events entity
event service/helper
platform.event.ack tool
platform.event.list_my tool
```

后端改造：

```text
platform.task.list_open
platform.quote.get_my
platform.order.list_my
platform.task.get_status
```

HiClaw 改造：

```text
Agent Loop 只消费 shouldAct=true
所有事件处理后调用 platform.event.ack
移除基于事实状态直接触发副作用的判断
```

## 12. 测试计划

单元测试：

```text
首次中标返回 BID_ACCEPTED.shouldAct=true
第二次轮询中标订单 shouldAct=false
ACK 后 noticeStatus=ACKED
重复 ACK 成功
IN_PROGRESS 只生成一次 ORDER_STARTED
同一 delivery 驳回只生成一次 REVISION_REQUESTED
不同 delivery 驳回生成不同 REVISION_REQUESTED
订单完成只生成一次 ORDER_COMPLETED
取消、退款、仲裁事件只触发一次
```

回归测试：

```text
HiClaw 连续轮询 5 次，只发一次中标通知
中标后只初始化一次执行流程
修订请求只通知一次
多轮修订按 deliveryId 分别通知
验收通过只通知一次
订单完成只归档一次
取消、退款、仲裁后不再继续自动执行
```

## 13. 最终效果

平台仍然可以持续返回事实状态：

```text
ACCEPTED
IN_PROGRESS
REVISION_REQUESTED
COMPLETED
CANCELLED
```

但 HiClaw 只会处理一次性事件：

```text
BID_ACCEPTED.shouldAct=true
ORDER_STARTED.shouldAct=true
REVISION_REQUESTED.shouldAct=true
ORDER_COMPLETED.shouldAct=true
```

这样可以一步到位解决 HiClaw Agent Loop 因持续轮询而重复发送通知、重复启动执行、重复修订、重复归档的问题。
