# CSI Agent Owner Console — 雇主侧/Marketplace 集成 API 契约

> **目的**：定义 Agent Owner Console 与雇主侧/Marketplace 之间的完整 API 契约，覆盖 PRD §5/6/7.7/9.6/9.6.1 涉及的全部跨服务交互场景。
>
> **职责边界**：本文档仅设计 Agent Owner Console 如何与雇主侧/Marketplace 服务模块对接。交易管理、任务大厅、评价信誉体系等业务层的内部技术方案由其他同事负责，不在本文档范围内。
>
> **实现基座**：fork Multica 项目（Go，chi router + sqlc + gorilla/websocket），在 fork 后的 repo 上开发 CSI Agent Owner Console。当前 repo 的 Node.js 代码仅为 PoC，不作为实现基座。
>
> **PRD 对齐**：PRD 描述的是业务需求，不规定技术实现。PRD 中"工作流编排"等表述是为了通俗易懂地表达业务流程，本契约通过 Multica 原生模型（Project Task + @mention Comment）实现相同的业务意图。
>
> **日期**：2026-08-02
> **状态**：架构审查

---

## 目录

1. [概述](#1-概述)
2. [集成模式](#2-集成模式)
3. [鉴权与安全](#3-鉴权与安全)
4. [幂等机制](#4-幂等机制)
5. [错误码体系](#5-错误码体系)
6. [超时处理](#6-超时处理)
7. [一致性保障](#7-一致性保障)
8. [API 命名规范与版本化](#8-api-命名规范与版本化)
9. [场景一：商机投递](#9-场景一商机投递)
10. [场景二：竞标方案提交](#10-场景二竞标方案提交)
11. [场景三：雇主选标通知](#11-场景三雇主选标通知)
12. [场景四：Project 创建](#12-场景四project-创建)
13. [场景五：Spec 签订流程](#13-场景五spec-签订流程)
14. [场景六：交付验收流程](#14-场景六交付验收流程)
15. [场景七：修订协商流程](#15-场景七修订协商流程)
16. [场景八：Spec 变更流程](#16-场景八spec-变更流程)
17. [场景九：协商取消与结算](#17-场景九协商取消与结算)
18. [结算触发（场景九续）](#18-结算触发场景九续)
19. [对账 API](#19-对账-api)
20. [演进路径](#20-演进路径)
21. [Workspace 档案发现（场景外公共能力）](#21-workspace-档案发现场景外公共能力)
22. [决策记录](#22-决策记录)
23. [附录](#23-附录)

---

## 1. 概述

### 1.1 背景

CSI 是双边平台：雇主发布任务、Agent Owner 通过 Workspace 竞标和交付。Agent Owner Console 是 CSI 的执行层，负责管理"AI 接到任务 → 自主规划 → 落地执行 → 验证交付"全流程。交易管理、任务大厅、评价信誉体系等属于业务层，由雇主侧/Marketplace 服务承载。

本契约定义 Console 与 Marketplace 之间的所有 API 接口，确保双方对接清晰、可落地。

### 1.2 实体关系

```
Marketplace 侧:                              Console 侧:
Marketplace Task (1)                          Workspace (1)
     │                                             │
     │  (中标后创建)                                │  (投递时创建)
     ▼                                             ▼
  Order (1) ◄──── 冗余 ID ────► Project (1) ◄── 关联 ── Opportunity (N)
     │                                             │              │
     │                                             ▼              │
     │                                          Plan/Task/      (workspace_id,
     │                                          交付物            marketplace_task_id) 唯一
     │
     ▼
  Spec/验收/结算
```

**关联本质**：Project → Opportunity → Marketplace Task ← Order。`project_id` ↔ `order_id` 是双方冗余的优化字段，不是必需关联路径。即使 Project 上不冗余 `order_id` / `marketplace_task_id`，也能通过关联的 Opportunity 联系到对方的 Marketplace Task / Order。

### 1.3 双侧实体职责划分

| 字段 | Marketplace Order | Console Project |
|------|--------------------|-----------------|
| order_id / project_id（PK，共享） | ✅ | ✅（FK，冗余） |
| marketplace_task_id | ✅ | ✅（从 Opportunity 取） |
| workspace_id | ✅ | ✅ |
| employer_id | ✅ | ❌（Console 不需要） |
| contract_status（契约签订中/契约已签订/已取消） | ✅ | 同步缓存 |
| spec_snapshot | ✅ | 同步缓存 |
| final_price | ✅ | 同步缓存 |
| delivery_status（待验收/已完成） | ✅ | 同步缓存 |
| plan | ❌ | ✅ |
| project_tasks DAG | ❌ | ✅ |
| deliverables | ❌ | ✅（生成时）+ Marketplace（提交后 metadata） |
| settlement_status | ✅ | ❌ |

### 1.4 超时触发方归属（"各管各的"原则）

| 超时场景 | 归属方 | 理由 |
|---------|--------|------|
| Spec 7 天雇主未确认 | Marketplace | 雇主侧治理 |
| 14 天自动验收 | Marketplace | 雇主侧治理 |
| 协商窗口 2 天默认 C | Marketplace | 雇主侧默认行为 |
| 24h 修订判定默认 | Console | Agent Owner 侧治理 |
| 3 天取消响应默认 | Console | Agent Owner 侧治理 |
| 席位满 72h 雇主决策 | Marketplace | 雇主侧治理 |

---

## 2. 集成模式

### 2.1 混合模式（同步 RPC + 异步 Webhook）

| 模式 | 适用场景 | 示例 |
|------|---------|------|
| **同步 RPC** | 查询类、提交类（需立即知道结果） | 拉商机、提交竞标、推 Spec、推交付物、触发结算 |
| **异步 Webhook** | 通知类事件（天然异步） | 选标通知、Spec 确认回调、验收回调、超时事件 |

不引入消息总线（Kafka/RabbitMQ），降低跨团队共建成本。未来可演进（见 §19）。

### 2.2 API 端点归属

**Console 提供的 Webhook（Marketplace 调用 Console）**：

| Webhook | 事件 |
|---------|------|
| `POST /v1/webhooks/opportunity/pushed` | 平台推送商机（Push 模式） |
| `POST /v1/webhooks/bid/result` | 选标通知（中标/未中标/全部驳回） |
| `POST /v1/webhooks/task/employer-reply` | 雇主回复 Mention 通知 |
| `POST /v1/webhooks/spec/employer-action` | 雇主对 Spec 的确认/驳回/超时 |
| `POST /v1/webhooks/delivery/employer-review` | 雇主对交付物的验收/驳回/要求修订 |
| `POST /v1/webhooks/project/cancel-request` | 雇主发起协商取消 |
| `POST /v1/webhooks/project/cancel-counter-response` | 雇主对部分结算方案响应 |
| `POST /v1/webhooks/project/cancel-resolution` | 取消协商结果通知 |
| `POST /v1/webhooks/project/dispute-raised` | 纠纷发起通知 |
| `POST /v1/webhooks/spec-change/request` | 雇主发起变更/修订请求 |
| `POST /v1/webhooks/spec-change/employer-confirmation` | 雇主对"新增需求"二次确认 |
| `POST /v1/webhooks/revision/negotiation-action` | 修订协商决策通知 |
| `POST /v1/webhooks/settlement/result` | 结算完成通知 |
| `POST /v1/webhooks/settlement/appeal-period-closed` | 申诉期关闭通知 |

**Console 提供的 Partner 只读 API（Marketplace 调用 Console，§21）**：

| API | 用途 |
|-----|------|
| `GET /v1/partner/workspaces` | Workspace 公开档案列表（增量拉取，§21.2） |
| `GET /v1/partner/workspaces/{workspace_id}` | Workspace 公开档案详情（§21.2） |
| `GET /v1/partner/orgs/{org_id}/workspaces` | Owner 名下 workspace 列表（大厅手动派发选目标，§21.2） |

**Marketplace 提供的 API（Console 调用 Marketplace）**：

| API | 用途 |
|-----|------|
| `GET /v1/marketplace/tasks` | 拉取任务大厅列表（Pull 模式） |
| `GET /v1/marketplace/tasks/{task_id}` | 查任务详情 |
| `POST /v1/marketplace/tasks/{task_id}/bids` | 提交竞标方案 |
| `PATCH /v1/marketplace/orders/{order_id}` | 回填 project_id |
| `GET /v1/marketplace/orders/{order_id}/status` | 对账查询 |
| `POST /v1/marketplace/orders/{order_id}/employer-mentions` | 推 Mention 通知给雇主 |
| `POST /v1/marketplace/orders/{order_id}/spec` | 推 Spec 给雇主确认 |
| `POST /v1/marketplace/orders/{order_id}/deliverables` | 提交交付物 metadata |
| `POST /v1/marketplace/orders/{order_id}/spec-changes` | Spec 变更提案 |
| `POST /v1/marketplace/orders/{order_id}/spec-changes/{change_id}/confirm` | 确认 Spec 变更 |
| `POST /v1/marketplace/orders/{order_id}/spec-changes/{change_id}/reject` | 拒绝 Spec 变更 |
| `POST /v1/marketplace/orders/{order_id}/revision-negotiation/start` | 启动修订协商窗口 |
| `POST /v1/marketplace/orders/{order_id}/revision-negotiation/{negotiation_id}/decide` | 修订协商 4 选项决策 |
| `POST /v1/marketplace/orders/{order_id}/cancel-requests/{request_id}/respond` | Agent Owner 响应取消请求 |
| `POST /v1/marketplace/orders/{order_id}/cancel-requests/{request_id}/auto-resolve` | Agent Owner 超时自动处理 |
| `POST /v1/marketplace/orders/{order_id}/cancel-requests/{request_id}/finalize` | 最终确认取消结算 |
| `POST /v1/marketplace/orders/{order_id}/cancel-requests/{request_id}/to-dispute` | 转纠纷 |
| `POST /v1/marketplace/orders/{order_id}/revision-requests/{request_id}/classify` | 修订/新增需求判定 |
| `POST /v1/marketplace/orders/{order_id}/settlement/trigger` | 触发结算 |
| `GET /v1/marketplace/orders/{order_id}/settlement` | 查询结算状态 |
| `GET /v1/marketplace/workspaces/{workspace_id}/orders` | 查询 Workspace 的 Order 列表 |
| `GET /v1/marketplace/workspaces/{workspace_id}/settlements` | 查询 Workspace 的结算列表 |
| `POST /v1/webhooks/workspace/changed` | 接收 Console 推送的 Workspace 生命周期事件（§21.3，Console→Marketplace 事件端点） |

---

## 3. 鉴权与安全

### 3.1 方案：服务级长期 Token + HMAC 签名

| 维度 | 方案 |
|------|------|
| 调用方身份 | 每个调用方持有 service token（如 `csi-console-token`、`csi-marketplace-token`），K8s Secret 注入 |
| Token 轮换 | 双方约定 rotation endpoint，提前 7 天双发新 token，旧 token 24h 过渡期后失效 |

### 3.2 请求头规范

**所有请求通用头**：

```
Authorization: Bearer <service_token>
X-Signature: t=<unix_ts>,v1=<hmac_sha256(body + ts)>
X-Request-Id: <uuid-v7>
User-Agent: csi-console/1.0 (go-chi) | csi-marketplace/1.0
Content-Type: application/json
```

**写操作额外头**：

```
Idempotency-Key: <uuid-v7>
```

**响应通用头**：

```
X-Request-Id: <同请求>
X-Response-Id: <uuid-v7>
```

### 3.3 接收方验证流程

1. Bearer token 比对
2. timestamp 与当前时间偏差 ≤ 5min
3. 重放窗口内 nonce 唯一
4. HMAC-SHA256 重算比对（`body + timestamp`）

### 3.4 Webhook 投递语义

| 维度 | 规则 |
|------|------|
| 投递语义 | At-least-once（至少一次），接收方必须幂等 |
| 投递确认 | HTTP 2xx 视为成功；4xx 不重试（业务错误）；5xx 重试 |
| 重试策略 | 5s / 30s / 2min / 10min / 1h 共 5 次 |
| 死信 | 5 次仍失败进死信表，触发平台告警，人工介入 |

---

## 4. 幂等机制

### 4.1 Webhook 投递幂等

接收方按 `(event_id, event_type)` 去重，event_id 由发送方生成（UUID v7）。

**永久去重表**（兼作审计日志）：

```sql
CREATE TABLE inbound_webhook_events (
    event_id          UUID PRIMARY KEY,           -- 发送方生成
    event_type        TEXT NOT NULL,              -- 'bid.won' 等
    source            TEXT NOT NULL,              -- 'marketplace' / 'console'
    received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload_hash      TEXT NOT NULL,              -- body sha256
    processing_state  TEXT NOT NULL,              -- received/processing/processed/failed
    response_code     INT,
    error_message     TEXT
);
```

重复 event_id 命中且 `processing_state = 'processed'` → 直接返回原 response_code，不重复执行业务逻辑。

### 4.2 组合幂等

- **调用方 `Idempotency-Key` 头**：通用兜底，覆盖没有天然业务键的操作（如"触发结算"）
- **业务自然键 DB UNIQUE 约束**：覆盖有天然业务键的操作（如商机、竞标、Spec 版本）

### 4.3 业务幂等键清单

| 操作 | 业务幂等键 | 实现方式 |
|------|----------|---------|
| 商机 Push / Pull | `(workspace_id, marketplace_task_id)` | DB UNIQUE 约束（PRD §5.2） |
| 提交竞标方案 | `(marketplace_task_id, bid_round, workspace_id)` | DB UNIQUE：每轮每 workspace 一标 |
| Spec 推送 | `(project_id, spec_version)` | DB UNIQUE：每版本一次 |
| 交付物提交 | `(project_id, submission_seq)` | DB UNIQUE：每次提交递增 seq |
| 验收回调 | `(project_id, review_round)` | DB UNIQUE：每轮验收一次 |
| Spec 变更请求 | `(project_id, change_seq)` | DB UNIQUE：变更序号 |
| 修订请求 | `(project_id, revision_round)` | DB UNIQUE：修订轮次 |
| 取消协商 | `(project_id, cancel_proposal_seq)` | DB UNIQUE：每次提案递增 |
| 触发结算 | `(project_id)` | DB UNIQUE：一个 Project 仅一次结算 |

---

## 5. 错误码体系

### 5.1 错误响应体格式（RFC 7807 + 业务扩展）

```json
{
  "type": "https://csi.example.com/errors/seat-full",
  "title": "Bid seat full",
  "status": 409,
  "detail": "All 20 bid seats for this task in round 3 are occupied",
  "instance": "/v1/marketplace/tasks/T-1001/bids",
  "request_id": "uuid",
  "error_code": "SEAT_FULL",
  "details": {
    "task_id": "T-1001",
    "bid_round": 3,
    "seat_limit": 20,
    "current_seats": 20
  },
  "retry_after_seconds": null
}
```

### 5.2 错误码分类与命名规范

| 类别前缀 | 含义 | HTTP 状态码范围 | 示例 |
|---------|------|----------------|------|
| `AUTH_*` | 鉴权失败 | 401/403 | `AUTH_TOKEN_INVALID`, `AUTH_HMAC_SIGNATURE_MISMATCH`, `AUTH_TIMESTAMP_EXPIRED` |
| `VALIDATION_*` | 请求参数校验 | 400/422 | `VALIDATION_PAYLOAD_INVALID`, `VALIDATION_SPEC_SCHEMA_INVALID`, `VALIDATION_MILESTONE_WEIGHT_INVALID`, `VALIDATION_GATE_NOT_PASSED`, `VALIDATION_INVALID_OPTION` |
| `NOT_FOUND_*` | 资源不存在 | 404 | `NOT_FOUND_TASK`, `NOT_FOUND_ORDER`, `NOT_FOUND_PROJECT`, `NOT_FOUND_CANCEL_REQUEST` |
| `CONFLICT_*` | 资源状态冲突 | 409 | `CONFLICT_SEAT_FULL`, `CONFLICT_SPEC_VERSION_CONFLICT`, `CONFLICT_BID_ALREADY_SUBMITTED`, `CONFLICT_SUBMISSION_SEQ_CONFLICT`, `CONFLICT_SPEC_CHANGE_ALREADY_PROPOSED`, `CONFLICT_SETTLEMENT_ALREADY_TRIGGERED`, `CONFLICT_PROCESSING_IN_PROGRESS`, `VALIDATION_IDEMPOTENCY_CONFLICT` |
| `STATE_*` | 业务状态不允许操作 | 422 | `STATE_OPPORTUNITY_NOT_BIDDABLE`, `STATE_PROJECT_NOT_CANCELLABLE`, `STATE_PROJECT_NOT_SPEC_SIGNING`, `STATE_PROJECT_NOT_DELIVERABLE`, `STATE_PROJECT_NOT_EXECUTING`, `STATE_PROJECT_NOT_COMPLETED`, `STATE_SPEC_ALREADY_CONFIRMED`, `STATE_CANCEL_REQUEST_RESOLVED`, `STATE_NEGOTIATION_NOT_ACTIVE`, `STATE_TASK_NOT_BIDDABLE`, `STATE_WORKSPACE_NOT_ELIGIBLE` |
| `RATE_LIMIT_*` | 限流 | 429 | `RATE_LIMIT_EXCEEDED` |
| `UPSTREAM_*` | 依赖服务故障 | 502/503 | `UPSTREAM_MARKETPLACE_UNAVAILABLE`, `UPSTREAM_CONSOLE_UNAVAILABLE` |
| `INTERNAL_*` | 内部错误 | 500 | `INTERNAL_DB_ERROR`, `INTERNAL_UNKNOWN` |

### 5.3 可重试 vs 不可重试规则

| 错误类别 | 是否可重试 | 重试策略 |
|---------|----------|---------|
| `AUTH_*` | ❌ 不可重试 | 修正鉴权后重试 |
| `VALIDATION_*` | ❌ 不可重试 | 修正请求后重试 |
| `NOT_FOUND_*` | ❌ 不可重试 | 资源不存在，重试无意义 |
| `CONFLICT_*` | ❌ 不可重试 | 业务冲突，需修正业务状态 |
| `STATE_*` | ❌ 不可重试 | 业务状态不允许，需状态变更 |
| `RATE_LIMIT_*` | ✅ 可重试 | `retry_after_seconds` 指示间隔 |
| `UPSTREAM_*` | ✅ 可重试 | 退避重试 |
| `INTERNAL_*` | ✅ 可重试 | 退避重试 |

响应体 `retry_after_seconds` 字段：可重试时给值（如 30、60、300），不可重试为 null。

---

## 6. 超时处理

### 6.1 超时分级

| 档位 | 超时 | 适用操作 |
|------|------|---------|
| **短** | 5s | 查询类（GET）、轻量写（Comment mention、状态查询） |
| **中** | 15s | 一般写操作（提交竞标、Spec、交付物 metadata、结算 trigger） |
| **长** | 60s | 大文件相关（签名 URL 生成、批量操作） |

### 6.2 各 API 超时清单

| API | 调用方 → 接收方 | 超时 |
|-----|----------------|------|
| `GET /v1/marketplace/tasks` (Pull) | Console → Marketplace | 10s |
| `GET /v1/marketplace/tasks/{id}` | Console → Marketplace | 5s |
| `POST /v1/marketplace/tasks/{id}/bids` | Console → Marketplace | 15s |
| `POST /v1/marketplace/orders/{id}/employer-mentions` | Console → Marketplace | 10s |
| `POST /v1/marketplace/orders/{id}/spec` | Console → Marketplace | 15s |
| `POST /v1/marketplace/orders/{id}/deliverables` | Console → Marketplace | 15s |
| `PATCH /v1/marketplace/orders/{id}` (回填 project_id) | Console → Marketplace | 10s |
| `POST /v1/marketplace/orders/{id}/cancel-requests/{id}/respond` | Console → Marketplace | 10s |
| `POST /v1/marketplace/orders/{id}/spec-changes` | Console → Marketplace | 15s |
| `POST /v1/marketplace/orders/{id}/revision-negotiation/{id}/decide` | Console → Marketplace | 10s |
| `POST /v1/marketplace/orders/{id}/settlement/trigger` | Console → Marketplace | 15s |
| `GET /v1/marketplace/orders/{id}/settlement` | Console → Marketplace | 5s |
| `POST /v1/webhooks/*` (全部) | Marketplace → Console | 10s |

### 6.3 超时后行为

**调用方超时后**：
1. 不假设接收方未处理 — 可能已处理但响应未送达
2. 用 `Idempotency-Key` 或业务幂等键重试，接收方去重
3. 同步 RPC：超时后立即重试 1 次，仍超时进入退避重试（最多 3 次：5s/30s/2min）
4. Webhook：at-least-once（5 次退避：5s/30s/2min/10min/1h）
5. 死信：5 次仍失败，写死信表 + 告警，人工介入

### 6.4 慢请求兜底

接收方处理慢但已开始执行 → 调用方超时重试 → 接收方用幂等键去重，返回首次处理结果。若首次处理尚未完成 → 返回 `409 Conflict + error_code: CONFLICT_PROCESSING_IN_PROGRESS`，调用方延后重试。

### 6.5 超时配置化

```
CSI_HTTP_TIMEOUT_SHORT=5s
CSI_HTTP_TIMEOUT_MEDIUM=15s
CSI_HTTP_TIMEOUT_LONG=60s
CSI_HTTP_RETRY_MAX=3
CSI_WEBHOOK_RETRY_MAX=5
CSI_WEBHOOK_RETRY_BACKOFF=5s,30s,2m,10m,1h
```

---

## 7. 一致性保障

### 7.1 一致性模型：最终一致性

双方各自更新本地状态，短暂不一致由业务流程兜底；关键节点用 webhook 同步。不使用 Saga 或事件溯源。

### 7.2 关键场景一致性窗口

| 场景 | 一致性窗口 | 不一致期间的影响 | 兜底 |
|------|----------|----------------|------|
| 选标 → Project 创建 | Marketplace 已 selected，Console 未创建 Project（~1s） | Console 侧查不到 Project | webhook 重试 |
| Spec 提交 → Console 缓存 spec_version | Marketplace 已新版本，Console 缓存旧版本 | Console 侧用旧版本展示 | Console 下次同步时拉取最新 |
| 交付物提交 → Marketplace 显示 | Console 已 done，Marketplace 未提交 | 雇主看不到交付物 | Console 主动调提交 API |
| 验收回调 → Console 更新 Project | Marketplace 已 accepted，Console 未更新 | Console 侧 Project 仍"待验收" | webhook 重试 |
| 结算触发 → Console 收到结果 | Marketplace 已结算，Console 未收到通知 | Agent Owner 看不到结算状态 | Console 主动查询 |

### 7.3 四层兜底机制

| 层 | 机制 | 覆盖 |
|----|------|------|
| **层 1** | Webhook 重试（at-least-once + 5 次退避） | 瞬时故障 |
| **层 2** | 主动对账查询（Console 每 10min 跑状态同步任务，调 Marketplace 查询所有 in-flight Order 状态，与本地 Project 状态对比，发现不一致则修复） | 长时间不一致 |
| **层 3** | 死信告警（5 次重试失败的 webhook 进死信表，触发告警，人工介入） | 重试耗尽 |
| **层 4** | 业务容忍（中间状态在业务上可接受，关键操作必须等 webhook ACK 后才对外展示"已完成"） | 设计原则 |

### 7.4 终态操作双向确认

资金/法律相关的终态操作（结算完成、Project 终态），需要双方都确认：

```
1. Console 调 POST /settlement/trigger → Marketplace 返回 202
2. Marketplace 处理结算 → 调 Console webhook: settlement.completed
3. Console 收到 webhook → Project 标记 "已完成（已结算）"

如果 Console 未收到 webhook:
- 层 2 主动查询 → GET /orders/{id}/status 发现 settlement_status=completed → 标记完成
- 层 3 死信告警
```

---

## 8. API 命名规范与版本化

### 8.1 版本化策略

URL 路径版本：`/v1/marketplace/tasks`、`/v1/webhooks/bid/result`。公测版 = v1，未来破坏性变更走 v2，老版本保留过渡期。

### 8.2 URL 路径命名规范

- 全小写，连字符分隔（`revision-negotiation` 不用 `revisionNegotiation`）
- 资源用复数（`tasks`、`orders`）
- 动作用动词（`confirm`、`reject`、`respond`、`trigger`）
- ID 用 UUID v7

### 8.3 Webhook Payload 统一信封

所有 webhook 共用统一外层结构：

```json
{
  "event_id": "uuid-v7",
  "event_type": "bid.won",
  "event_version": 1,
  "occurred_at": "2026-08-02T10:00:00Z",
  "sent_at": "2026-08-02T10:00:01Z",
  "source": "marketplace",
  "data": {
    // ...各事件具体字段
  }
}
```

**event_type 命名**：`{domain}.{action_past_tense}`，点分式：
- `opportunity.pushed`
- `bid.won` / `bid.lost` / `bid.batch_rejected`
- `spec.confirmed` / `spec.rejected` / `spec.timeout`
- `delivery.accepted` / `delivery.rejected` / `delivery.revision_requested` / `delivery.auto_accepted`
- `project.cancel_requested` / `project.cancel_resolved` / `project.dispute_raised`
- `spec_change.requested` / `spec_change.employer_confirmed` / `spec_change.employer_rejected`
- `revision.negotiation_started` / `revision.negotiation_decided` / `revision.negotiation_auto_accepted`
- `settlement.completed` / `settlement.appeal_period_closed`
- `task.employer_reply`
- `workspace.created` / `workspace.updated` / `workspace.deleted`（§21.3，C→M 方向——Console 推、Marketplace 收，与上述 M→C 事件方向相反）

---

## 9. 场景一：商机投递

### 9.1 模式一：平台推送（Push）

**方向**：Marketplace → Console Webhook

```
POST /v1/webhooks/opportunity/pushed
```

**鉴权**：Bearer Token + HMAC 签名

**幂等**：`event_id` 去重 + 业务幂等键 `(workspace_id, marketplace_task_id)` DB UNIQUE

**超时**：10s

**请求体**：

```json
{
  "event_id": "01923e8a-uuid-v7",
  "event_type": "opportunity.pushed",
  "event_version": 1,
  "occurred_at": "2026-08-02T10:00:00Z",
  "sent_at": "2026-08-02T10:00:01Z",
  "source": "marketplace",
  "data": {
    "opportunity_id": "uuid-v7",
    "workspace_id": "uuid-v7",
    "marketplace_task_id": "uuid-v7",
    "source_type": "platform_push",
    "match_score": 75,
    "task_brief": {
      "title": "企业官网开发",
      "description": "...",
      "category": "web-development",
      "budget_range": {"min": 10000, "max": 20000},
      "expected_delivery_date": "2026-09-15",
      "seat_limit": 20,
      "bid_round": 1,
      "attachments": [{"name": "需求文档.pdf", "url": "...", "type": "pdf"}],
      "published_at": "2026-08-02T09:30:00Z",
      "expires_at": "2026-09-01T09:30:00Z"
    },
    "pushed_at": "2026-08-02T10:00:00Z"
  }
}
```

**响应**：

```json
200 OK
{
  "received": true,
  "opportunity_id": "uuid-v7",
  "deduplicated": false
}
```

**错误场景**：

| 错误码 | HTTP | 场景 |
|--------|------|------|
| `AUTH_HMAC_SIGNATURE_MISMATCH` | 401 | 签名校验失败 |
| `VALIDATION_PAYLOAD_INVALID` | 400 | payload 格式错误 |
| `INTERNAL_DB_ERROR` | 500 | Console 内部错误 |

**处理逻辑**：
1. Console 收到 webhook → 写入 `inbound_webhook_events`（永久去重表）
2. 检查 `(workspace_id, marketplace_task_id)` 是否已有商机记录
3. 已存在 → 静默跳过，返回 `deduplicated: true`
4. 不存在 → 创建商机记录（状态"待处理"，`source = "platform_push"`），返回 `deduplicated: false`

### 9.2 模式二：Workspace 主动拉取（Pull）

**方向**：Console → Marketplace

```
GET /v1/marketplace/tasks?category=web-development,data-analysis&status=open&bid_round=active&since=2026-08-01T00:00:00Z&limit=50&cursor=opaque_next_page
```

**鉴权**：Bearer Token + HMAC 签名

**幂等**：GET 天然幂等；商机创建靠 `(workspace_id, marketplace_task_id)` DB UNIQUE 兜底

**超时**：10s

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `category` | string | 类目列表，逗号分隔 |
| `status` | string | 任务状态，默认 `open` |
| `bid_round` | string | `active` = 当前可竞标轮次 |
| `since` | ISO8601 | 增量游标，只返回此时间之后发布/更新的任务 |
| `limit` | int | 每页数量，默认 50 |
| `cursor` | string | 分页游标（opaque） |

**响应**：

```json
200 OK
{
  "tasks": [
    {
      "task_id": "uuid-v7",
      "title": "企业官网开发",
      "description": "...",
      "category": "web-development",
      "budget_range": {"min": 10000, "max": 20000},
      "expected_delivery_date": "2026-09-15",
      "seat_limit": 20,
      "current_seats": 12,
      "bid_round": 1,
      "attachments": [{"name": "需求文档.pdf", "url": "...", "type": "pdf"}],
      "published_at": "2026-08-02T09:30:00Z",
      "expires_at": "2026-09-01T09:30:00Z"
    }
  ],
  "next_cursor": "opaque_string",
  "has_more": false
}
```

**处理逻辑**：
1. Console 定时器（每 5min）或 Agent Owner 手动触发
2. 调此 API 拉取任务列表
3. 将任务列表交给 `auto_discover_agent_id` 指定的 Agent 逐个分析
4. Agent 判定"匹配" → 检查幂等 → 创建商机记录（`source = "pull"`）
5. Console 维护每个类目的 `last_pull_cursor`（= 响应中最后一条 task 的 `published_at`），下次拉取传 `since`

### 9.3 模式三：Agent Owner 手动派发（Manual Assign）

**纯 Console 内部动作**，不涉及跨服务调用。

Agent Owner 在 Console 内嵌的任务大厅视图（Console 调 `GET /v1/marketplace/tasks` 拉取展示）中浏览任务，点击"派发到我的 Workspace"后：
1. Console 检查幂等 `(workspace_id, marketplace_task_id)`
2. 不存在 → 创建商机记录（`source = "manual_assign"`），投递到 Inbox
3. 已存在 → 提示"该商机已在 Workspace 中"

商机在竞标提交时才需要 Marketplace 知道（占席位），手动派发阶段不需要通知 Marketplace。

### 9.4 查询任务详情

```
GET /v1/marketplace/tasks/{task_id}
```

**超时**：5s

**响应**：同 9.2 中单个 task 结构。

---

## 10. 场景二：竞标方案提交

### 10.1 提交竞标方案

**方向**：Console → Marketplace

```
POST /v1/marketplace/tasks/{task_id}/bids
```

**鉴权**：Bearer Token + HMAC 签名 + `Idempotency-Key` 头

**幂等**：业务幂等键 `(marketplace_task_id, bid_round, workspace_id)` DB UNIQUE + `Idempotency-Key` 头兜底

**超时**：15s

**请求体**：

```json
{
  "workspace_id": "uuid-v7",
  "opportunity_id": "uuid-v7",
  "bid_round": 1,
  "bid_content": {
    "proposal_text": "我们将使用 Next.js + Tailwind 开发企业官网...",
    "price": 15000,
    "estimated_delivery_date": "2026-09-10",
    "estimated_delivery_days": 30,
    "workspace_brief": {
      "name": "Acme AI Studio",
      "brand_tagline": "专业 Web 开发",
      "capability_tags": ["web-development", "saas"]
    }
  },
  "source_type": "platform_push | pull | manual_assign",
  "submitted_at": "2026-08-02T10:30:00Z"
}
```

**响应（成功，占据席位）**：

```json
201 Created
{
  "bid_id": "uuid-v7",
  "task_id": "uuid-v7",
  "workspace_id": "uuid-v7",
  "bid_round": 1,
  "seat_number": 13,
  "seat_status": "occupied",
  "seat_limit": 20,
  "current_seats": 13,
  "seat_remaining": 7,
  "submitted_at": "2026-08-02T10:30:00Z",
  "platform_recommended_label": true,
  "similarity_warning": {
    "triggered": false,
    "similarity_score": 0.72,
    "similar_count": 0
  }
}
```

**响应（席位已满）**：

```json
409 Conflict
{
  "type": "https://csi.example.com/errors/seat-full",
  "title": "Bid seat full",
  "status": 409,
  "detail": "All 20 bid seats for this task in round 1 are occupied",
  "instance": "/v1/marketplace/tasks/T-1001/bids",
  "request_id": "uuid-v7",
  "error_code": "CONFLICT_SEAT_FULL",
  "details": {
    "task_id": "T-1001",
    "bid_round": 1,
    "seat_limit": 20,
    "current_seats": 20
  },
  "retry_after_seconds": null
}
```

**错误场景**：

| 错误码 | HTTP | 场景 |
|--------|------|------|
| `NOT_FOUND_TASK` | 404 | task_id 不存在 |
| `STATE_TASK_NOT_BIDDABLE` | 422 | 任务不在招标中 |
| `CONFLICT_SEAT_FULL` | 409 | 席位已满 |
| `CONFLICT_BID_ALREADY_SUBMITTED` | 409 | 该 workspace 已在当前轮次竞标 |
| `STATE_WORKSPACE_NOT_ELIGIBLE` | 422 | workspace 已被驳回/中标失效不可再竞标 |
| `CONFLICT_PROCESSING_IN_PROGRESS` | 409 | 同一幂等键正在处理中 |

**处理逻辑**：
1. Marketplace 校验 task 状态、workspace 资格、席位
2. 全部通过 → 创建 bid 记录，占 1 席位，返回 201 全量字段
3. Console 收到 201 → 更新商机状态"已竞标"，写入 `bid_content` + `bid_id` / `seat_number` / `bid_round`
4. Console 收到 409 (`CONFLICT_SEAT_FULL`) → 商机标注"席位已满"
5. Marketplace 在每次成功 `POST /bids` 后检查 `current_seats == seat_limit`，命中则启动 72h 雇主决策倒计时（Marketplace 内部）

**席位满 72h 超时自动全部驳回**（Marketplace 触发）：
```
Marketplace 72h 定时器到期 → 自动执行全部驳回
  → 更新本地 bid 状态 → rejected
  → 调 Console webhook: POST /v1/webhooks/bid/result
     payload: {event_type: "bid.batch_rejected", task_id, bid_round, rejected_bid_ids: [...], reason: "employer_timeout_72h"}
```

---

## 11. 场景三：雇主选标通知

### 11.1 中标通知

**方向**：Marketplace → Console Webhook（按 workspace 拆分，每个 workspace 收到自己那条）

```
POST /v1/webhooks/bid/result
```

**鉴权**：Bearer Token + HMAC 签名

**幂等**：`event_id` 去重

**超时**：10s

**请求体（中标）**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "bid.won",
  "event_version": 1,
  "occurred_at": "2026-08-03T14:00:00Z",
  "sent_at": "2026-08-03T14:00:01Z",
  "source": "marketplace",
  "data": {
    "task_id": "uuid-v7",
    "bid_id": "uuid-v7",
    "workspace_id": "uuid-v7",
    "opportunity_id": "uuid-v7",
    "bid_round": 1,
    "order_id": "uuid-v7",
    "employer_brief": {
      "employer_id": "uuid-v7",
      "employer_display_name": "ABC 公司",
      "task_title": "企业官网开发",
      "task_description": "...",
      "category": "web-development",
      "budget_range": {"min": 10000, "max": 20000},
      "expected_delivery_date": "2026-09-15",
      "attachments": [{"name": "需求文档.pdf", "url": "...", "type": "pdf"}]
    },
    "winning_bid": {
      "price": 15000,
      "estimated_delivery_date": "2026-09-10",
      "proposal_text": "...",
      "submitted_at": "2026-08-02T10:30:00Z"
    },
    "spec_signing_config": {
      "timeout_days": 7,
      "reminder_schedule_days": [3, 5, 7]
    },
    "selected_at": "2026-08-03T14:00:00Z"
  }
}
```

**响应**：

```json
200 OK
{
  "received": true,
  "project_id": "uuid-v7",
  "project_created": true
}
```

> **注**：Console 收到中标 webhook 后，先返回 200 ACK（快速），再异步创建 Project 并反向 PATCH 回填 project_id（见 §12）。响应中的 `project_id` 可为 null（异步创建尚未完成），`project_created: false` 表示尚未创建。

### 11.2 未中标通知

**请求体（未中标）**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "bid.lost",
  "event_version": 1,
  "occurred_at": "2026-08-03T14:00:00Z",
  "sent_at": "2026-08-03T14:00:01Z",
  "source": "marketplace",
  "data": {
    "task_id": "uuid-v7",
    "bid_id": "uuid-v7",
    "workspace_id": "uuid-v7",
    "opportunity_id": "uuid-v7",
    "bid_round": 1,
    "winner_workspace_id": "uuid-v7",
    "reason": "employer_selected_other",
    "selected_at": "2026-08-03T14:00:00Z"
  }
}
```

**响应**：

```json
200 OK
{
  "received": true
}
```

**处理逻辑**：Console 收到后更新商机状态 → "未中标"（终态）。

### 11.3 全部驳回通知

**请求体（全部驳回，含席位满 72h 超时自动驳回）**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "bid.batch_rejected",
  "event_version": 1,
  "occurred_at": "2026-08-04T10:00:00Z",
  "sent_at": "2026-08-04T10:00:01Z",
  "source": "marketplace",
  "data": {
    "task_id": "uuid-v7",
    "bid_id": "uuid-v7",
    "workspace_id": "uuid-v7",
    "opportunity_id": "uuid-v7",
    "bid_round": 1,
    "reason": "employer_rejected_all | employer_timeout_72h",
    "task_reopened": {
      "new_bid_round": 2,
      "seats_archived": true,
      "reopened_at": "2026-08-04T10:00:00Z"
    },
    "rejected_at": "2026-08-04T10:00:00Z"
  }
}
```

**处理逻辑**：Console 收到后更新商机状态 → "已驳回"（终态）。

**错误场景**：

| 错误码 | HTTP | 场景 |
|--------|------|------|
| `AUTH_HMAC_SIGNATURE_MISMATCH` | 401 | 签名校验失败 |
| `VALIDATION_PAYLOAD_INVALID` | 400 | payload 格式错误 |
| `INTERNAL_DB_ERROR` | 500 | Console 内部错误 |

---

## 12. 场景四：Project 创建

### 12.1 创建流程（Console 自主创建 + 反向回填 project_id）

Console 收到 `bid.won` webhook 后：

```
1. 写入 inbound_webhook_events（永久去重表）
2. 返回 200 ACK（快速）
3. 异步处理:
   a. 更新 Opportunity 状态 → "中标"（关联 order_id）
   b. 基于该 Opportunity 创建 Project:
      {
        project_id: <uuid-v7, Console 生成>,
        opportunity_id: <FK>,
        order_id: <冗余, 从 webhook 取>,
        workspace_id: <从 Opportunity 取>,
        marketplace_task_id: <从 Opportunity 取>,
        status: "契约签订中",
        created_at: now()
      }
   c. 创建 Spec 签约 Project Task（见 §13）
   d. 调 Marketplace 反向 PATCH 回填 project_id（见 12.2）
```

### 12.2 回填 project_id

**方向**：Console → Marketplace

```
PATCH /v1/marketplace/orders/{order_id}
```

**鉴权**：Bearer Token + HMAC 签名 + `Idempotency-Key` 头

**幂等**：`Idempotency-Key` 头；同一 project_id 多次 PATCH 幂等

**超时**：10s

**请求体**：

```json
{
  "project_id": "uuid-v7",
  "project_status": "契约签订中",
  "project_created_at": "2026-08-03T14:00:05Z"
}
```

**响应**：

```json
200 OK
{
  "order_id": "uuid-v7",
  "project_id": "uuid-v7",
  "updated_at": "2026-08-03T14:00:06Z"
}
```

**错误场景**：

| 错误码 | HTTP | 场景 |
|--------|------|------|
| `NOT_FOUND_ORDER` | 404 | order_id 不存在 |
| `VALIDATION_PAYLOAD_INVALID` | 400 | payload 格式错误 |
| `UPSTREAM_MARKETPLACE_UNAVAILABLE` | 503 | Marketplace 不可用 |

### 12.3 Project 创建失败兜底

若 Console 异步创建 Project 失败（DB 故障等）：
- webhook 重试（at-least-once + 5 次退避）
- 5 次仍失败 → 进死信表 + 平台告警，人工介入
- Marketplace 侧 Order 已是 `contract_signing` 状态，不回滚（PRD §5.6.5 选标后不可反悔）

---

## 13. 场景五：Spec 签订流程

### 13.1 设计核心：Project Task + @mention Comment 唯一真相源

Spec 签订通过 Multica 原生 Project Task 模型实现，而非工作流编排引擎：

- **Project Task**：中标后 Console 自主创建一个"Spec 签约 Task"，目标 = 生成 Spec 并签约
- **Comment 唯一真相源**：所有沟通（Agent ↔ Agent Owner ↔ Employer）都通过 Task Comment，Console DB 是唯一存储
- **@employer Mention 通知**：Agent/Owner @employer 时，Console 推一条 Mention 通知到 Marketplace；雇主在 Marketplace 回复，通过 webhook 写回 Console Comment

现实类比：
- 工作室中标后与甲方频繁电话/微信沟通需求 = Agent @employer 发 Mention，雇主回复写回 Comment
- 乙方自主判断需求清晰后草拟合同 = Agent 自主判断后调 Spec 提交 API
- 甲方反馈合同要改 = 雇主驳回 Spec，Agent 继续工作
- 双方始终谈不拢 = 兜底机制触发协商取消

### 13.2 推送 Mention 通知给雇主

**方向**：Console → Marketplace

当 Agent 或 Agent Owner 在 Task Comment 中 @employer 时，Console 推送 Mention 通知：

```
POST /v1/marketplace/orders/{order_id}/employer-mentions
```

**鉴权**：Bearer Token + HMAC 签名 + `Idempotency-Key` 头

**幂等**：`Idempotency-Key` 头 + `mention_id` UUID 去重

**超时**：10s

**请求体**：

```json
{
  "mention_id": "uuid-v7",
  "project_task_id": "uuid-v7",
  "project_id": "uuid-v7",
  "source_comment_id": "uuid-v7",
  "from": {
    "type": "agent | agent_owner",
    "id": "uuid-v7",
    "display_name": "Dev Agent | 张三"
  },
  "content": {
    "text": "@employer 请问登录功能是否需要支持微信 OAuth？",
    "attachments": [
      {"name": "需求分析草案.pdf", "url": "https://console.../files/{id}?token=xxx", "type": "pdf"}
    ]
  },
  "related_spec_id": "uuid-v7 | null",
  "related_spec_version": 2,
  "reply_endpoint_hint": "https://console.../v1/webhooks/task/employer-reply",
  "sent_at": "2026-08-04T10:00:00Z"
}
```

**响应**：

```json
201 Created
{
  "mention_id": "uuid-v7",
  "received_at": "2026-08-04T10:00:01Z"
}
```

**错误场景**：

| 错误码 | HTTP | 场景 |
|--------|------|------|
| `NOT_FOUND_ORDER` | 404 | order_id 不存在 |
| `STATE_PROJECT_NOT_SPEC_SIGNING` | 422 | Project 不在签约阶段 |
| `VALIDATION_PAYLOAD_INVALID` | 400 | payload 格式错误 |
| `CONFLICT_PROCESSING_IN_PROGRESS` | 409 | 同一幂等键正在处理中 |

**附件处理**：Console 生成的附件用签名 URL（如 `https://console.../files/{id}?token=xxx`），Marketplace 在雇主查看时代理下载或直链。

### 13.3 雇主回复 Mention 通知

**方向**：Marketplace → Console Webhook

雇主在 Marketplace 看到 Mention 通知后回复，回复内容写回 Console 的 Task Comment：

```
POST /v1/webhooks/task/employer-reply
```

**鉴权**：Bearer Token + HMAC 签名

**幂等**：`event_id` 去重

**超时**：10s

**请求体**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "task.employer_reply",
  "event_version": 1,
  "occurred_at": "2026-08-04T10:30:00Z",
  "sent_at": "2026-08-04T10:30:01Z",
  "source": "marketplace",
  "data": {
    "mention_id": "uuid-v7",
    "source_comment_id": "uuid-v7",
    "project_task_id": "uuid-v7",
    "project_id": "uuid-v7",
    "order_id": "uuid-v7",
    "from": {
      "type": "employer",
      "id": "uuid-v7",
      "display_name": "ABC 公司"
    },
    "content": {
      "text": "需要支持微信和 Google 登录",
      "attachments": [
        {"name": "参考截图.png", "url": "https://marketplace.../files/{id}", "type": "png"}
      ]
    },
    "in_reply_to_comment_id": "uuid-v7",
    "sent_at": "2026-08-04T10:30:00Z"
  }
}
```

**响应**：

```json
200 OK
{
  "received": true,
  "comment_id": "uuid-v7"
}
```

**Console 内部处理**：

```sql
-- 直接作为 Comment 插入到 Task Comment 表（与 Multica 原生 Comment 完全一致）
INSERT INTO task_comments (
  comment_id, project_task_id, author_type, author_id,
  content_text, content_attachments,
  in_reply_to_comment_id, source,
  created_at
) VALUES (...);
-- source = 'employer_reply'

-- 同 Multica 原生 Comment 一样触发通知机制
-- @mentioned 的 Agent/Owner 收到 Inbox 通知
-- Agent 若在等待雇主回复 → 唤醒继续工作
```

**关键**：对 Agent 来说，雇主的回复就是一条普通 Comment，与同事回复完全一致，天然进入 Task 上下文，天然触发 Agent 唤醒。

**附件异步拉取**：雇主在 Marketplace 回复时上传的附件，先存 Marketplace，Console 收到 webhook 后异步拉取并存到自己的存储（保持 Comment 自包含）。

### 13.4 提交 Spec 给雇主确认

**方向**：Console → Marketplace

Agent 自主判断需求已足够清晰 → 生成 Spec（PRD §6.4 结构化 JSON）→ 可选让 Agent Owner 审阅 → Console 跨服务调 Marketplace：

```
POST /v1/marketplace/orders/{order_id}/spec
```

**鉴权**：Bearer Token + HMAC 签名 + `Idempotency-Key` 头

**幂等**：业务幂等键 `(project_id, spec_version)` DB UNIQUE + `Idempotency-Key` 头

**超时**：15s

**请求体**：

```json
{
  "project_id": "uuid-v7",
  "spec": {
    "version": 1,
    "goal": "开发企业官网，包含首页、产品页、关于我们、联系表单",
    "requirements": [
      {
        "id": "req-001",
        "title": "响应式首页",
        "description": "支持 PC/移动端自适应",
        "priority": "must_have"
      }
    ],
    "scope_boundary": "不包含后端 API 开发、不包含部署运维",
    "acceptance_criteria": [
      {
        "id": "ac-001",
        "requirement_id": "req-001",
        "description": "首页在 375px/768px/1440px 三个断点下布局正确",
        "verification_method": "manual_browser_check"
      }
    ],
    "deliverables": [
      {
        "id": "del-001",
        "name": "源代码包",
        "type": "code",
        "format": ".zip",
        "description": "完整 Next.js 项目源码"
      }
    ],
    "final_price": 15000,
    "estimated_delivery_date": "2026-09-10",
    "revision_limit": 2,
    "milestones": [
      {"id": "m-001", "name": "首页 + 产品页", "weight": 40, "deliverable_ids": ["del-001"]},
      {"id": "m-002", "name": "关于我们 + 联系表单", "weight": 30, "deliverable_ids": ["del-001"]},
      {"id": "m-003", "name": "联调验收", "weight": 30, "deliverable_ids": ["del-001"]}
    ]
  },
  "snapshot_hash": "sha256:abc123...",
  "submitted_by": "agent:uuid-v7",
  "submitted_at": "2026-08-05T10:00:00Z"
}
```

**响应**：

```json
202 Accepted
{
  "spec_id": "uuid-v7",
  "order_id": "uuid-v7",
  "version": 1,
  "status": "awaiting_employer_confirmation",
  "timeout_at": "2026-08-12T10:00:00Z",
  "reminder_schedule": ["2026-08-08", "2026-08-10", "2026-08-12"]
}
```

**错误场景**：

| 错误码 | HTTP | 场景 |
|--------|------|------|
| `STATE_PROJECT_NOT_SPEC_SIGNING` | 422 | Project 不在签约阶段 |
| `CONFLICT_SPEC_VERSION_CONFLICT` | 409 | 该 version 已存在 |
| `VALIDATION_SPEC_SCHEMA_INVALID` | 422 | Spec 结构不符合 PRD §6.4 |
| `VALIDATION_MILESTONE_WEIGHT_INVALID` | 422 | 里程碑权重之和 ≠ 100% |
| `NOT_FOUND_ORDER` | 404 | order_id 不存在 |

### 13.5 雇主对 Spec 的操作回调

**方向**：Marketplace → Console Webhook（单一 endpoint + event_type 区分）

```
POST /v1/webhooks/spec/employer-action
```

**请求体（确认）**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "spec.confirmed",
  "event_version": 1,
  "occurred_at": "2026-08-06T14:00:00Z",
  "sent_at": "2026-08-06T14:00:01Z",
  "source": "marketplace",
  "data": {
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "spec_id": "uuid-v7",
    "spec_version": 1,
    "confirmed_at": "2026-08-06T14:00:00Z"
  }
}
```

**请求体（驳回）**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "spec.rejected",
  "event_version": 1,
  "occurred_at": "2026-08-06T14:00:00Z",
  "sent_at": "2026-08-06T14:00:01Z",
  "source": "marketplace",
  "data": {
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "spec_id": "uuid-v7",
    "spec_version": 1,
    "reject_reason": "需求范围不清晰",
    "reject_items": ["ac-001"],
    "review_attachments": [{"name": "反馈说明.pdf", "url": "..."}],
    "rejected_at": "2026-08-06T14:00:00Z"
  }
}
```

**请求体（7 天超时自动取消）**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "spec.timeout",
  "event_version": 1,
  "occurred_at": "2026-08-12T10:00:00Z",
  "sent_at": "2026-08-12T10:00:01Z",
  "source": "marketplace",
  "data": {
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "spec_id": "uuid-v7",
    "spec_version": 1,
    "next_action": "auto_cancel",
    "task_reopened": {
      "task_id": "uuid-v7",
      "new_bid_round": 2
    },
    "reason": "employer_timeout_7d",
    "timed_out_at": "2026-08-12T10:00:00Z"
  }
}
```

**响应**：

```json
200 OK
{
  "received": true
}
```

**Console 处理逻辑**：
- `spec.confirmed` → Project 状态 → "执行中"，Spec Task done，进入 Phase 3
- `spec.rejected` → Spec Task 重开，Agent 看驳回反馈 + 继续对话，可修订 Spec version+1 重新提交
- `spec.timeout` → Project 状态 → "已取消"，Opportunity 状态 → "中标失效"，停止 Spec 签约工作流

### 13.6 兜底机制（替代 PRD §6.3.3 的硬轮次）

| 兜底场景 | 触发条件 | 处理 | 触发方 |
|---------|---------|------|--------|
| 单次 Spec 雇主不响应 | Spec 提交后 7 天 | 自动取消 Project（见 13.5 `spec.timeout`） | Marketplace |
| Spec 反复驳回无法达成 | Spec 驳回次数 ≥ 5 次（可配置） | 进入协商取消 | Marketplace 检测，通知 Console |
| 整个签约阶段超时 | Project 创建后 30 天仍未签订 Spec | 进入协商取消 | Marketplace 检测，通知 Console |
| 对话停滞 | 双方均无新 Comment/Mention 14 天 | 提醒级催办（不强制取消） | Marketplace 检测，通知 Console |

**Spec 驳回 5 次触发协商取消**（Marketplace 检测并通知）：

```
POST /v1/webhooks/project/cancel-request
（见 §17 协商取消流程，auto_reason: "spec_rejected_5_times"）
```

---

## 14. 场景六：交付验收流程

### 14.1 提交交付物

**方向**：Console → Marketplace

Agent 完成所有 Project Task + 所有 Evidence Gates（G1/G2/G3/G6 + G4/G5）通过后，Console 提交交付物 metadata（文件已存 Console 的 Project Artifact Store，此处仅传 metadata + 签名 URL）：

```
POST /v1/marketplace/orders/{order_id}/deliverables
```

**鉴权**：Bearer Token + HMAC 签名 + `Idempotency-Key` 头

**幂等**：业务幂等键 `(project_id, submission_seq)` DB UNIQUE + `Idempotency-Key` 头

**超时**：15s

**请求体**：

```json
{
  "project_id": "uuid-v7",
  "project_task_id": "uuid-v7",
  "submission_seq": 1,
  "deliverables": [
    {
      "deliverable_id": "uuid-v7",
      "name": "企业官网源代码",
      "type": "code",
      "format": ".zip",
      "spec_deliverable_id": "uuid-v7",
      "description": "完整 Next.js 项目源码",
      "artifact_url": "https://console.../files/{id}?token=xxx",
      "artifact_hash": "sha256:abc123...",
      "size_bytes": 12345678
    }
  ],
  "delivery_report": {
    "summary": "已完成所有需求，包含首页、产品页、关于我们、联系表单",
    "spec_acceptance_checklist": [
      {"criterion_id": "ac-001", "status": "met", "evidence": "在 Chrome/Safari/Firefox 测试通过"}
    ]
  },
  "gates_status": {
    "g1_configuration": "passed",
    "g2_format": "passed",
    "g3_dependencies": "passed",
    "g4_quality_review": "passed",
    "g5_cross_module": "passed",
    "g6_artifacts": "passed",
    "verified_at": "2026-08-15T09:00:00Z"
  },
  "submitted_at": "2026-08-15T10:00:00Z"
}
```

**响应**：

```json
201 Created
{
  "submission_id": "uuid-v7",
  "order_id": "uuid-v7",
  "project_id": "uuid-v7",
  "review_deadline": "2026-08-29T10:00:00Z",
  "review_reminder_schedule": ["2026-08-20", "2026-08-24", "2026-08-28"],
  "submitted_at": "2026-08-15T10:00:00Z"
}
```

**错误场景**：

| 错误码 | HTTP | 场景 |
|--------|------|------|
| `STATE_PROJECT_NOT_DELIVERABLE` | 422 | Project 不在交付阶段 |
| `CONFLICT_SUBMISSION_SEQ_CONFLICT` | 409 | submission_seq 已存在 |
| `VALIDATION_GATE_NOT_PASSED` | 422 | G1/G2/G3/G6 未通过 |
| `NOT_FOUND_ORDER` | 404 | order_id 不存在 |

**Marketplace 处理**：
- 收到 `gates_status` 全 passed → 启动 14 天验收计时
- 第 5/9/13 天催办雇主（PRD §9.4）

### 14.2 雇主验收结果回调

**方向**：Marketplace → Console Webhook

```
POST /v1/webhooks/delivery/employer-review
```

**请求体（验收通过）**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "delivery.accepted",
  "event_version": 1,
  "occurred_at": "2026-08-20T14:00:00Z",
  "sent_at": "2026-08-20T14:00:01Z",
  "source": "marketplace",
  "data": {
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "submission_id": "uuid-v7",
    "submission_seq": 1,
    "review_round": 1,
    "reviewed_at": "2026-08-20T14:00:00Z"
  }
}
```

**请求体（驳回）**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "delivery.rejected",
  "event_version": 1,
  "occurred_at": "2026-08-20T14:00:00Z",
  "sent_at": "2026-08-20T14:00:01Z",
  "source": "marketplace",
  "data": {
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "submission_id": "uuid-v7",
    "submission_seq": 1,
    "review_round": 1,
    "review_notes": "联系表单提交后无反馈",
    "rejected_items": [
      {"deliverable_id": "uuid-v7", "reason": "表单功能缺陷", "related_criterion_id": "ac-001"}
    ],
    "review_attachments": [{"name": "问题截图.png", "url": "..."}],
    "reviewed_at": "2026-08-20T14:00:00Z"
  }
}
```

**请求体（要求修订）**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "delivery.revision_requested",
  "event_version": 1,
  "occurred_at": "2026-08-20T14:00:00Z",
  "sent_at": "2026-08-20T14:00:01Z",
  "source": "marketplace",
  "data": {
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "submission_id": "uuid-v7",
    "submission_seq": 1,
    "review_round": 1,
    "revision_round": 1,
    "revision_limit": 2,
    "review_notes": "需要优化首页加载速度",
    "rejected_items": [
      {"deliverable_id": "uuid-v7", "reason": "首屏加载 > 3s", "related_criterion_id": "ac-001"}
    ],
    "review_attachments": [{"name": "性能报告.pdf", "url": "..."}],
    "reviewed_at": "2026-08-20T14:00:00Z"
  }
}
```

**请求体（14 天自动验收）**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "delivery.auto_accepted",
  "event_version": 1,
  "occurred_at": "2026-08-29T10:00:00Z",
  "sent_at": "2026-08-29T10:00:01Z",
  "source": "marketplace",
  "data": {
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "submission_id": "uuid-v7",
    "submission_seq": 1,
    "review_round": 1,
    "auto_reason": "employer_timeout_14d",
    "reviewed_at": "2026-08-29T10:00:00Z"
  }
}
```

**响应**：

```json
200 OK
{
  "received": true
}
```

**Console 处理逻辑**：
- `delivery.accepted` / `delivery.auto_accepted` → Project 状态 → "已完成"，Task done，进入结算流程（见 §17）
- `delivery.rejected` → Project 状态 → "交付被驳回"（终态，可走纠纷）
- `delivery.revision_requested` → Project 状态 → "修订中"，revision_round +1，Agent 继续工作；若 revision_round > revision_limit → 触发修订协商（见 §15）

---

## 15. 场景七：修订协商流程

### 15.1 启动修订协商窗口

**方向**：Console → Marketplace

Console 在收到 `delivery.revision_requested` 后检查 `current_revision_round >= revision_limit`，命中则通知 Marketplace 启动 2 天协商窗口：

```
POST /v1/marketplace/orders/{order_id}/revision-negotiation/start
```

**鉴权**：Bearer Token + HMAC 签名 + `Idempotency-Key` 头

**幂等**：`Idempotency-Key` 头；同一 negotiation 不重复启动

**超时**：10s

**请求体**：

```json
{
  "project_id": "uuid-v7",
  "submission_id": "uuid-v7",
  "revision_round": 3,
  "revision_limit": 2,
  "reason": "revision_limit_exceeded",
  "current_deliverables_snapshot": [
    {"deliverable_id": "uuid-v7", "name": "企业官网源代码", "version": "v3"}
  ],
  "started_at": "2026-08-25T10:00:00Z"
}
```

**响应**：

```json
202 Accepted
{
  "negotiation_id": "uuid-v7",
  "deadline": "2026-08-27T10:00:00Z",
  "options": ["A", "B", "C", "D"]
}
```

**错误场景**：

| 错误码 | HTTP | 场景 |
|--------|------|------|
| `STATE_NEGOTIATION_NOT_ACTIVE` | 422 | 已有进行中的协商 |
| `NOT_FOUND_ORDER` | 404 | order_id 不存在 |

### 15.2 协商 4 选项决策

**方向**：双向（任一方可发起）

```
POST /v1/marketplace/orders/{order_id}/revision-negotiation/{negotiation_id}/decide
```

**鉴权**：Bearer Token + HMAC 签名 + `Idempotency-Key` 头

**幂等**：`Idempotency-Key` 头；同一 negotiation 仅一次有效决策

**超时**：10s

**请求体**：

```json
{
  "option": "A | B | C | D",
  "actor": "employer | agent_owner",
  "proposed_at": "2026-08-25T11:00:00Z",

  "additional_revision_limit": 2,

  "spec_change_proposal": {
    "change_summary": "增加数据导出功能",
    "estimated_extra_price": 2000,
    "estimated_extra_days": 5
  },

  "dispute_reason": "交付质量不达标",
  "dispute_evidence": [{"name": "问题清单.pdf", "url": "..."}]
}
```

> 各选项仅需传相关字段：A 传 `additional_revision_limit`，B 传 `spec_change_proposal`，C 无额外字段，D 传 `dispute_reason` + `dispute_evidence`。

**响应**：

```json
200 OK
{
  "negotiation_id": "uuid-v7",
  "option": "A",
  "status": "accepted | awaiting_counterparty_consent",
  "decided_at": "2026-08-25T11:00:00Z"
}
```

**双方同意机制**（PRD §7.7.3：A/B 需对方同意；C 雇主发起无需同意；D 任一方发起无需同意）：
- A/B 发起方调 `/decide` → `status: awaiting_counterparty_consent` → 对方收到 webhook → 同意则调 `/decide` `{option: "A", actor: "agent_owner", accept: true}` → `status: accepted`
- A/B 拒绝 → 协商窗口继续（不重置 2 天计时）
- C 雇主发起 → 直接 `status: accepted`
- D 任一方发起 → 直接 `status: accepted` → 进入纠纷

**错误场景**：

| 错误码 | HTTP | 场景 |
|--------|------|------|
| `STATE_NEGOTIATION_NOT_ACTIVE` | 422 | 协商窗口已关闭 |
| `VALIDATION_INVALID_OPTION` | 422 | option 不是 A/B/C/D |

### 15.3 协商窗口 2 天超时默认 C

**方向**：Marketplace → Console Webhook（Marketplace 触发）

```
POST /v1/webhooks/revision/negotiation-action
```

**请求体（2 天超时默认 C）**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "revision.negotiation_auto_accepted",
  "event_version": 1,
  "occurred_at": "2026-08-27T10:00:00Z",
  "sent_at": "2026-08-27T10:00:01Z",
  "source": "marketplace",
  "data": {
    "negotiation_id": "uuid-v7",
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "submission_id": "uuid-v7",
    "option": "C",
    "auto_reason": "negotiation_timeout_2d",
    "acted_at": "2026-08-27T10:00:00Z"
  }
}
```

**请求体（双方决策完成通知）**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "revision.negotiation_decided",
  "event_version": 1,
  "occurred_at": "2026-08-25T12:00:00Z",
  "sent_at": "2026-08-25T12:00:01Z",
  "source": "marketplace",
  "data": {
    "negotiation_id": "uuid-v7",
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "option": "A | B | C | D",
    "decided_by": "employer | agent_owner | both",
    "additional_revision_limit": 2,
    "decided_at": "2026-08-25T12:00:00Z"
  }
}
```

**Console 处理逻辑**：
- option A → 追加修订次数，Project 回到"修订中"
- option B → 转 Spec 变更流程（见 §16）
- option C → Project 状态 → "已完成"，进入结算流程
- option D → Project 状态 → "纠纷处理中"，停止所有自动定时器

---

## 16. 场景八：Spec 变更流程

### 16.1 雇主发起修订/变更请求

**方向**：Marketplace → Console Webhook

雇主在 Marketplace 发起"要求修订"：

```
POST /v1/webhooks/spec-change/request
```

**请求体**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "spec_change.requested",
  "event_version": 1,
  "occurred_at": "2026-08-22T10:00:00Z",
  "sent_at": "2026-08-22T10:00:01Z",
  "source": "marketplace",
  "data": {
    "request_id": "uuid-v7",
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "submission_id": "uuid-v7",
    "requested_by": "employer",
    "request_content": {
      "description": "想增加一个数据导出功能",
      "related_deliverable_id": "uuid-v7",
      "related_criterion_id": "ac-001",
      "attachments": [{"name": "需求说明.pdf", "url": "..."}]
    },
    "requested_at": "2026-08-22T10:00:00Z"
  }
}
```

**Console 处理**：启动 24h Agent Owner 判定计时（Console 内部定时器），通知 Agent Owner "有 24h 内判定的请求待处理"。

### 16.2 修订/新增需求判定

**方向**：Console → Marketplace

Agent Owner 24h 内响应（A=修订 / B=新增需求），或 24h 超时默认 A：

```
POST /v1/marketplace/orders/{order_id}/revision-requests/{request_id}/classify
```

**鉴权**：Bearer Token + HMAC 签名 + `Idempotency-Key` 头

**幂等**：`Idempotency-Key` 头；`request_id` 去重

**超时**：10s

**请求体**：

```json
{
  "classification": "revision | new_requirement",
  "classified_by": "agent_owner | system",
  "classified_at": "2026-08-22T15:00:00Z",
  "auto_reason": "agent_owner_timeout_24h | null",
  "notes": "属于原 Spec 范围内的优化"
}
```

**响应**：

```json
200 OK
{
  "request_id": "uuid-v7",
  "classification": "revision",
  "next_action": "revision_flow | employer_confirmation"
}
```

**处理逻辑**：
- `classification: "revision"` → 走 §7.7 修订流程（占用 revision_limit）
- `classification: "new_requirement"` → Marketplace 通知雇主二次确认（见 16.3）

### 16.3 雇主二次确认（新增需求）

**方向**：Marketplace → Console Webhook

```
POST /v1/webhooks/spec-change/employer-confirmation
```

**请求体**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "spec_change.employer_confirmed | spec_change.employer_rejected",
  "event_version": 1,
  "occurred_at": "2026-08-23T10:00:00Z",
  "sent_at": "2026-08-23T10:00:01Z",
  "source": "marketplace",
  "data": {
    "request_id": "uuid-v7",
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "employer_response": {
      "confirmed": true,
      "notes": "同意作为新增需求"
    },
    "responded_at": "2026-08-23T10:00:00Z"
  }
}
```

**Console 处理**：
- `employer_confirmed` → 走 Spec 变更流程（见 16.4）
- `employer_rejected` → Console 启动 24h 协商窗口；到点未协商一致进纠纷

### 16.4 Spec 变更提案

**方向**：双向（任一方可发起）

```
POST /v1/marketplace/orders/{order_id}/spec-changes
```

**鉴权**：Bearer Token + HMAC 签名 + `Idempotency-Key` 头

**幂等**：业务幂等键 `(project_id, change_seq)` DB UNIQUE + `Idempotency-Key` 头

**超时**：15s

**请求体**：

```json
{
  "change_id": "uuid-v7",
  "project_id": "uuid-v7",
  "source": "employer_request | negotiation_option_B",
  "trigger_request_id": "uuid-v7 | null",
  "proposed_by": "employer | agent_owner",
  "change_proposal": {
    "summary": "增加数据导出功能",
    "affected_requirements": [
      {"requirement_id": "req-001", "change_type": "add", "new_detail": "支持 CSV/Excel 导出"}
    ],
    "affected_acceptance_criteria": [
      {"criterion_id": "ac-new-001", "requirement_id": "req-001", "description": "用户可导出数据列表"}
    ],
    "affected_deliverables": [
      {"deliverable_id": "del-new-001", "name": "导出功能模块", "type": "code"}
    ],
    "price_adjustment": {"type": "increase", "amount": 2000, "new_total": 17000},
    "delivery_date_adjustment": {"type": "extend", "new_date": "2026-09-15", "extra_days": 5},
    "rationale": "新增功能需额外开发时间"
  },
  "proposed_at": "2026-08-23T11:00:00Z"
}
```

**响应**：

```json
202 Accepted
{
  "change_id": "uuid-v7",
  "status": "awaiting_counterparty_review",
  "review_deadline": "2026-08-26T11:00:00Z"
}
```

### 16.5 确认/拒绝 Spec 变更

```
POST /v1/marketplace/orders/{order_id}/spec-changes/{change_id}/confirm
POST /v1/marketplace/orders/{order_id}/spec-changes/{change_id}/reject
```

**请求体（确认）**：

```json
{
  "confirmed_by": "employer | agent_owner",
  "confirmed_at": "2026-08-24T10:00:00Z"
}
```

**请求体（拒绝）**：

```json
{
  "rejected_by": "employer | agent_owner",
  "reject_reason": "价格调整不合理",
  "rejected_at": "2026-08-24T10:00:00Z"
}
```

**confirm 响应**：

```json
200 OK
{
  "change_id": "uuid-v7",
  "new_spec_version": 2,
  "new_final_price": 17000,
  "new_estimated_delivery_date": "2026-09-15",
  "applied_at": "2026-08-24T10:00:00Z"
}
```

**变更生效后**：
- Console 侧：Spec 快照更新（version+1），Plan 调整（Orchestrator 重新规划受影响 Task）
- Marketplace 侧：Order 持有的 `spec_snapshot` 更新，`final_price` / `estimated_delivery_date` 更新

**错误场景**：

| 错误码 | HTTP | 场景 |
|--------|------|------|
| `STATE_PROJECT_NOT_EXECUTING` | 422 | Project 不在执行阶段 |
| `CONFLICT_SPEC_CHANGE_ALREADY_PROPOSED` | 409 | 同一变更已提案 |

### 16.6 Spec 变更超时

| 场景 | 超时 | 处理 | 触发方 |
|------|------|------|--------|
| 对方 3 天未响应变更提案 | 3 天 | 提案视为被拒绝，进入协商窗口 | 任一方触发 |
| 协商窗口 24h 无一致 | 24h | Project → 纠纷处理中 | Console 检测并通知 Marketplace |

---

## 17. 场景九：协商取消与结算

### 17.1 雇主发起协商取消

**方向**：Marketplace → Console Webhook

```
POST /v1/webhooks/project/cancel-request
```

**请求体**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "project.cancel_requested",
  "event_version": 1,
  "occurred_at": "2026-08-25T10:00:00Z",
  "sent_at": "2026-08-25T10:00:01Z",
  "source": "marketplace",
  "data": {
    "cancel_request_id": "uuid-v7",
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "requested_by": "employer",
    "reason": "预算调整",
    "auto_reason": "spec_rejected_5_times | null",
    "requested_at": "2026-08-25T10:00:00Z"
  }
}
```

**Console 处理**：
- Project 状态 → "协商取消中"
- Console 启动 3 天 Agent Owner 响应计时

### 17.2 Agent Owner 响应取消请求

**方向**：Console → Marketplace

```
POST /v1/marketplace/orders/{order_id}/cancel-requests/{request_id}/respond
```

**鉴权**：Bearer Token + HMAC 签名 + `Idempotency-Key` 头

**幂等**：`Idempotency-Key` 头；`request_id` 去重

**超时**：10s

**请求体（同意取消 + 自动部分结算）**：

```json
{
  "response": "accept",
  "settlement": {
    "settlement_id": "uuid-v7",
    "basis": "milestone_weight",
    "milestones_settled": [
      {"milestone_id": "m-001", "name": "首页 + 产品页", "weight": 40, "status": "verified_passed", "amount": 6000},
      {"milestone_id": "m-002", "name": "关于我们 + 联系表单", "weight": 30, "status": "verified_passed", "amount": 4500}
    ],
    "total_settlement_amount": 10500,
    "original_price": 15000
  },
  "responded_by": "agent_owner",
  "responded_at": "2026-08-26T10:00:00Z"
}
```

**请求体（提出部分结算方案）**：

```json
{
  "response": "counter_proposal",
  "settlement_proposal": {
    "proposal_id": "uuid-v7",
    "milestones_settled": [
      {"milestone_id": "m-001", "name": "首页 + 产品页", "weight": 40, "status": "verified_passed", "amount": 6000},
      {"milestone_id": "m-002", "name": "关于我们 + 联系表单", "weight": 30, "status": "verified_passed", "amount": 4500},
      {"milestone_id": "m-003", "name": "联调验收", "weight": 30, "status": "partial", "amount": 1500}
    ],
    "total_settlement_amount": 12000,
    "rationale": "联调验收已完成 50%"
  },
  "responded_by": "agent_owner",
  "responded_at": "2026-08-26T10:00:00Z"
}
```

**请求体（拒绝取消）**：

```json
{
  "response": "reject",
  "reason": "Project 接近完成，不应取消",
  "responded_by": "agent_owner",
  "responded_at": "2026-08-26T10:00:00Z"
}
```

**响应**：

```json
200 OK
{
  "cancel_request_id": "uuid-v7",
  "next_action": "order_cancelled | employer_confirmation | project_resumed"
}
```

### 17.3 Agent Owner 3 天超时自动处理

**方向**：Console → Marketplace

```
POST /v1/marketplace/orders/{order_id}/cancel-requests/{request_id}/auto-resolve
```

**请求体（Project 在执行中 → 视为同意取消 + 自动部分结算）**：

```json
{
  "auto_reason": "agent_owner_timeout_3d",
  "project_phase": "executing",
  "settlement": {
    "settlement_id": "uuid-v7",
    "basis": "milestone_weight",
    "milestones_settled": [
      {"milestone_id": "m-001", "name": "首页 + 产品页", "weight": 40, "status": "verified_passed", "amount": 6000}
    ],
    "total_settlement_amount": 6000,
    "original_price": 15000
  }
}
```

**请求体（Project 在待验收 → 视为拒绝取消）**：

```json
{
  "auto_reason": "agent_owner_timeout_3d",
  "project_phase": "awaiting_review",
  "response": "reject"
}
```

### 17.4 雇主对部分结算方案的响应

**方向**：Marketplace → Console Webhook

```
POST /v1/webhooks/project/cancel-counter-response
```

**请求体**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "project.cancel_counter_responseed",
  "event_version": 1,
  "occurred_at": "2026-08-27T10:00:00Z",
  "sent_at": "2026-08-27T10:00:01Z",
  "source": "marketplace",
  "data": {
    "cancel_request_id": "uuid-v7",
    "proposal_id": "uuid-v7",
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "employer_response": "accept | reject",
    "notes": "同意结算方案",
    "responded_at": "2026-08-27T10:00:00Z"
  }
}
```

**Console 处理**：
- `accept` → Console 调 `/cancel-requests/{request_id}/finalize`（见 17.5）→ 执行结算
- `reject` → 进纠纷

### 17.5 最终确认取消结算

**方向**：Console → Marketplace

```
POST /v1/marketplace/orders/{order_id}/cancel-requests/{request_id}/finalize
```

**请求体**：

```json
{
  "finalized_by": "agent_owner",
  "settlement_confirmed": true,
  "finalized_at": "2026-08-27T11:00:00Z"
}
```

### 17.6 取消协商结果通知

**方向**：Marketplace → Console Webhook

```
POST /v1/webhooks/project/cancel-resolution
```

**请求体（雇主 3 天超时，存在可结算里程碑 → 自动结算）**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "project.cancel_resolved",
  "event_version": 1,
  "occurred_at": "2026-08-28T10:00:00Z",
  "sent_at": "2026-08-28T10:00:01Z",
  "source": "marketplace",
  "data": {
    "cancel_request_id": "uuid-v7",
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "resolution": "auto_settled",
    "auto_reason": "employer_timeout_3d",
    "settlement_confirmed": true,
    "resolved_at": "2026-08-28T10:00:00Z"
  }
}
```

**请求体（雇主 3 天超时，无可结算里程碑 → 进纠纷）**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "project.cancel_resolved",
  "event_version": 1,
  "occurred_at": "2026-08-28T10:00:00Z",
  "sent_at": "2026-08-28T10:00:01Z",
  "source": "marketplace",
  "data": {
    "cancel_request_id": "uuid-v7",
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "resolution": "to_dispute",
    "reason": "no_settleable_milestones",
    "resolved_at": "2026-08-28T10:00:00Z"
  }
}
```

### 17.7 转纠纷

**方向**：Console → Marketplace

当 Console 检测到无可结算里程碑（Spec + Task 状态都在 Console），主动调 Marketplace：

```
POST /v1/marketplace/orders/{order_id}/cancel-requests/{request_id}/to-dispute
```

**请求体**：

```json
{
  "reason": "no_settleable_milestones",
  "checked_at": "2026-08-26T12:00:00Z"
}
```

### 17.8 里程碑结算金额计算公式

```
结算金额 = Σ(里程碑权重 × Spec.final_price)  for each 里程碑 where status = "verified_passed"

例：Spec final_price = 15000
   里程碑 M1 weight=40% status=verified_passed → 6000
   里程碑 M2 weight=30% status=verified_passed → 4500
   里程碑 M3 weight=30% status=not_passed    → 0
   结算金额 = 10500

若所有 milestones weight 之和 ≠ 100%:
   → Spec 生成时校验拒绝（Console 在 Spec 提交前自检，返回 VALIDATION_MILESTONE_WEIGHT_INVALID）
```

---

## 18. 结算触发（场景九续）

### 18.1 触发结算

**方向**：Console → Marketplace

Project 状态变 "已完成" 时（验收通过 / 协商默认 C / 自动验收），Console 主动调结算触发 API：

```
POST /v1/marketplace/orders/{order_id}/settlement/trigger
```

**鉴权**：Bearer Token + HMAC 签名 + `Idempotency-Key` 头

**幂等**：业务幂等键 `(project_id)` DB UNIQUE + `Idempotency-Key` 头

**超时**：15s

**请求体**：

```json
{
  "settlement_id": "uuid-v7",
  "project_id": "uuid-v7",
  "trigger_source": "delivery_accepted | delivery_auto_accepted | negotiation_auto_accepted",
  "trigger_event_id": "uuid-v7",
  "final_price": 15000,
  "milestone_settlement": null,
  "triggered_at": "2026-08-20T15:00:00Z"
}
```

> `milestone_settlement` 仅协商取消部分结算时非 null，结构与 17.2 相同。

**响应**：

```json
202 Accepted
{
  "settlement_id": "uuid-v7",
  "status": "processing",
  "escrow_period_days": 7,
  "escrow_release_at": "2026-08-27T00:00:00Z",
  "estimated_payout_at": "2026-08-27T00:00:00Z"
}
```

**错误场景**：

| 错误码 | HTTP | 场景 |
|--------|------|------|
| `STATE_PROJECT_NOT_COMPLETED` | 422 | Project 未完成 |
| `CONFLICT_SETTLEMENT_ALREADY_TRIGGERED` | 409 | 已触发过结算 |

### 18.2 结算完成通知

**方向**：Marketplace → Console Webhook

```
POST /v1/webhooks/settlement/result
```

**请求体**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "settlement.completed",
  "event_version": 1,
  "occurred_at": "2026-08-20T15:05:00Z",
  "sent_at": "2026-08-20T15:05:01Z",
  "source": "marketplace",
  "data": {
    "settlement_id": "uuid-v7",
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "settlement_amount": 15000,
    "payout_amount": 13500,
    "commission_amount": 1500,
    "escrow_release_at": "2026-08-27T00:00:00Z",
    "completed_at": "2026-08-20T15:05:00Z"
  }
}
```

**Console 处理**：Project 标记"已完成（待申诉期结束）"，通知 Agent Owner "结算完成，7 天后可提现"。

### 18.3 售后申诉期内纠纷

**方向**：Marketplace → Console Webhook

PRD §9.4：7 天申诉期内雇主可发起纠纷。纠纷处理走 §9.7 平台仲裁（不在本契约范围），但 Console 需收到通知冻结状态：

```
POST /v1/webhooks/project/dispute-raised
```

**请求体**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "project.dispute_raised",
  "event_version": 1,
  "occurred_at": "2026-08-22T10:00:00Z",
  "sent_at": "2026-08-22T10:00:01Z",
  "source": "marketplace",
  "data": {
    "dispute_id": "uuid-v7",
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "settlement_id": "uuid-v7",
    "raised_by": "employer",
    "dispute_reason": "delivery_quality",
    "dispute_evidence": [{"name": "问题清单.pdf", "url": "..."}],
    "raised_during": "post_delivery_appeal",
    "raised_at": "2026-08-22T10:00:00Z"
  }
}
```

**Console 处理**：
- Project 状态 → "纠纷处理中"
- 冻结后续动作（如有）
- 等待平台仲裁结果通知（不在本契约范围）

### 18.4 申诉期关闭通知

**方向**：Marketplace → Console Webhook

PRD §9.4：7 天后未申诉视为最终认可。Marketplace 触发：

```
POST /v1/webhooks/settlement/appeal-period-closed
```

**请求体**：

```json
{
  "event_id": "uuid-v7",
  "event_type": "settlement.appeal_period_closed",
  "event_version": 1,
  "occurred_at": "2026-08-27T00:00:00Z",
  "sent_at": "2026-08-27T00:00:01Z",
  "source": "marketplace",
  "data": {
    "settlement_id": "uuid-v7",
    "order_id": "uuid-v7",
    "project_id": "uuid-v7",
    "disputes_raised": 0,
    "closed_at": "2026-08-27T00:00:00Z"
  }
}
```

**Console 处理**：
- Project 状态 → "已完成"（终态，不可逆）
- 通知 Agent Owner "结算完成，可提现"

### 18.5 查询结算状态

```
GET /v1/marketplace/orders/{order_id}/settlement
```

**超时**：5s

**响应**：

```json
200 OK
{
  "settlement_id": "uuid-v7",
  "order_id": "uuid-v7",
  "project_id": "uuid-v7",
  "settlement_amount": 15000,
  "payout_amount": 13500,
  "commission_amount": 1500,
  "status": "processing | completed | disputed",
  "escrow_release_at": "2026-08-27T00:00:00Z",
  "completed_at": "2026-08-20T15:05:00Z"
}
```

### 18.6 查询 Workspace 的结算列表

```
GET /v1/marketplace/workspaces/{workspace_id}/settlements?status=completed&since=2026-08-01T00:00:00Z&limit=50
```

**响应**：

```json
200 OK
{
  "settlements": [
    {
      "settlement_id": "uuid-v7",
      "order_id": "uuid-v7",
      "project_id": "uuid-v7",
      "settlement_amount": 15000,
      "payout_amount": 13500,
      "status": "completed",
      "completed_at": "2026-08-20T15:05:00Z"
    }
  ],
  "next_cursor": "opaque_string",
  "has_more": false
}
```

---

## 19. 对账 API

### 19.1 查询 Order 状态

Console 状态同步任务（每 10min）用此 API 批量查询所有 in-flight Order 的状态，与本地 Project 状态对比，发现不一致则修复。

```
GET /v1/marketplace/orders/{order_id}/status
```

**鉴权**：Bearer Token + HMAC 签名

**超时**：5s

**响应**：

```json
200 OK
{
  "order_id": "uuid-v7",
  "order_status": "contract_signing | executing | awaiting_review | completed | cancelled | disputed",
  "spec_status": {
    "current_version": 2,
    "status": "confirmed | rejected | awaiting_employer | timeout_cancelled",
    "confirmed_at": "2026-08-06T14:00:00Z | null"
  },
  "delivery_status": {
    "latest_submission_id": "uuid-v7 | null",
    "status": "pending_review | accepted | rejected | revision_requested | auto_accepted | not_submitted",
    "reviewed_at": "... | null"
  },
  "settlement_status": {
    "settlement_id": "uuid-v7 | null",
    "status": "not_triggered | processing | completed | disputed",
    "completed_at": "... | null"
  },
  "last_updated_at": "2026-08-20T15:00:00Z"
}
```

### 19.2 查询 Workspace 的 Order 列表

```
GET /v1/marketplace/workspaces/{workspace_id}/orders?status=active&since=2026-08-01T00:00:00Z&limit=50
```

**响应**：

```json
200 OK
{
  "orders": [
    {
      "order_id": "uuid-v7",
      "project_id": "uuid-v7",
      "marketplace_task_id": "uuid-v7",
      "order_status": "executing",
      "last_updated_at": "2026-08-20T15:00:00Z"
    }
  ],
  "next_cursor": "opaque_string",
  "has_more": false
}
```

### 19.3 对账任务设计

Console 内部跑定时任务（每 10min）：

```
1. 调 GET /v1/marketplace/workspaces/{workspace_id}/orders?status=active 拉取所有活跃 Order
2. 对每个 Order 调 GET /v1/marketplace/orders/{order_id}/status 查询详情
3. 与本地 Project 状态对比:
   - Order 已 completed 但 Project 未标记 → 修复（标记完成）
   - Order 已 cancelled 但 Project 仍执行中 → 修复（标记取消）
   - Order spec_status 已 confirmed 但 Project 仍"契约签订中" → 修复（标记执行中）
   - Order settlement_status 已 completed 但 Project 未标记结算 → 修复
4. 不一致修复后记录日志，触发告警（如频繁不一致）
```

---

## 20. 演进路径

### 20.1 事件订阅（v2 候选）

当前 Pull 模式（Console 主动调 Marketplace API）适合公测版。未来 Workspace 规模到千级以上、Pull 压力显现时，可引入事件订阅作为 Push 模式的扩展：

- Push 模式从"Marketplace 调 Console webhook"升级为"Marketplace 发事件到总线，Console 订阅"
- Pull 模式保留，作为 Workspace 自主扫描的兜底
- 两种模式语义仍清晰区分

事件订阅不替代 Pull，不进入公测版契约。

### 20.2 mTLS 升级

当前鉴权为服务级 Token + HMAC 签名。未来部署服务网格（Istio/Linkerd）后，可叠加 mTLS 作为传输层防御，HMAC 层保留作为应用层防御。

### 20.3 API 版本升级

公测版 = v1。未来破坏性变更走 v2，老版本保留过渡期（建议 6 个月），通过 `Accept-Version` 头或 URL 路径 `/v2/` 区分。

---

## 21. Workspace 档案发现（场景外公共能力）

> **状态**：我方主动提案（§7.1 流程，2026-09-04 B 组联调 Wave 契约缺口识别）——本节为发 Marketplace 团队的提案底稿，**字段级反馈窗口开放中**；我方按"独立优先"原则先行实现 Console 侧，不等对方排期。
>
> **定位**：场景外公共能力面——不隶属场景一~十的任何单条业务链，为 M 侧四个展示/派发场景提供 workspace 档案（卖方主体）的发现与获取能力，同时补齐 Push 撮合投递的目标池来源（M 投影 active workspace 集后才能路由 Push）。

### 21.0 动机（M 侧四个消费场景）

1. **大厅手动派发**：Agent Owner 逛 M 侧任务大厅 → 手动派发 task 到名下指定 workspace——M 前端需列出该 owner 的 workspace 供选择（端点三）；
2. **竞标席位展示**：M 侧 task 页每个席位展示竞标 workspace 信息（头像/名称），可点入主页（W3 席位快照 + 端点二）；
3. **workspace 主页**：M 侧展示 workspace 介绍页（端点二）；
4. **入驻画廊**：M 侧平台已入驻 workspace（AI 工作室）卡片页（端点一全量拉取）。

### 21.1 鉴权与通用约定

- **方向**：M→C（Marketplace 调 Console 的只读 API）。鉴权复用方向分离入站凭证（§3）：`Authorization: Bearer <inbound_token>` + `X-Signature` HMAC。
- **HMAC 输入**：GET 无 body，签名输入为**空串**（`t=<unix>,v1=<hex(HMAC-SHA256(secret, ""+t))>`——与 C→M 出站 GET 同口径；M 侧守卫对无 body 请求的 payload 派生须按空串，勿按 `'{}'`）。
- **org 名下列表鉴权**：复用同一方向分离入站凭证（服务间凭证已足够；per-org credential 属公测过度设计），`org_id` 为路径参数，由 Console 侧 `csi_org_bindings` 绑定关系解析归属。
- **限流**：per-IP 限流（Console 侧 `RATE_LIMIT_PARTNER`，默认 120/min），超限 429 `RATE_LIMIT_EXCEEDED`。
- **超时**：短档 5s（§6.2 GET 分级）。

### 21.2 W1：公开档案查询 API（三端点）

#### 公开档案对象 `PublicWorkspaceProfile`（字段白名单）

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `workspace_id` | string (uuid-v7) | workspace.id | 全局唯一标识 |
| `name` | string | 同名列 | 工作室名称 |
| `slug` | string | 同名列 | URL 标识（M 侧深链用） |
| `description` | string \| null | 同名列 | 简介（可空） |
| `avatar_url` | string \| null | 同名列 | 头像（Console 解析后的可渲染地址；空 = 无头像） |
| `capability_tags` | string[] | 999296 | 擅长类目（数组；M 侧撮合/画廊分类可直接用） |
| `service_commitments` | object | 999296 | 服务承诺（showcase 公开语义字段，键值对） |
| `agent_count` | int | 派生 `count(agents)` | Agent 规模 |
| `created_at` | string (RFC3339) | 同名列 | 入驻时间 |
| `updated_at` | string (RFC3339) | 同名列 | 增量拉取水位锚 |

**白名单边界（硬约束）**：序列化器**只输出上表 10 字段**。以下一律不外泄：CSI 业务配置 8 列（`auto_bid_enabled` / `default_orchestrator_agent_id` / `bid_approval_threshold` / `clarification_round_limit` / `mention_response_sla_hours` / `default_compute_budget_ratio` / `default_budget_alert_threshold` / `monthly_budget_cents`）、商机获取配置 3 列（`receive_platform_push` / `auto_discover_opportunity` / `auto_discover_agent_id`）、预算、token、runtime 细节、内部列（`settings` / `repos` / `context` / `issue_prefix`）、成员数据。Console 侧以白名单守卫测试钉死（新增字段须先修订本表）。

**public 开关**：公测不采用（字段本就是白名单级商务名片，画廊页 = 全量）；公测后如需 per-workspace 展示开关再按 §7.1 增补。

#### 端点一：`GET /v1/partner/workspaces`（列表，增量拉取）

Query 参数：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `since` | RFC3339 | 无 | `updated_at` 水位：仅返回 `updated_at > since` 的行（严格大于；重连补拉语义） |
| `limit` | int | 50 | 每页条数，上限 200（超限按 200 截断） |
| `cursor` | opaque string | 无 | 翻页续读 token（响应 `next_cursor` 原样回传；base64 keyset `(updated_at, id)`，不透明对待） |

`since` 与 `cursor` 可并用（首次用 `since` 起水位，后续翻页带 `cursor`）。

**200 响应**：

```json
{
  "workspaces": [ { "workspace_id": "0191…", "name": "…", "slug": "…", "description": "…", "avatar_url": "https://…", "capability_tags": ["web-dev", "data-viz"], "service_commitments": { "response_time": "2h" }, "agent_count": 6, "created_at": "2026-08-01T10:00:00Z", "updated_at": "2026-09-03T08:30:00Z" } ],
  "next_cursor": "Mdk5OTk…" 
}
```

无更多页时 `next_cursor` 为 `null`（字段恒出现，值为 null——非省略）。

**错误**：`AUTH_TOKEN_INVALID` / `AUTH_HMAC_SIGNATURE_MISMATCH` / `AUTH_TIMESTAMP_EXPIRED` 401；`VALIDATION_PAYLOAD_INVALID` 400（`since`/`cursor`/`limit` 不可解析）；`RATE_LIMIT_EXCEEDED` 429。

#### 端点二：`GET /v1/partner/workspaces/{workspace_id}`（详情）

**200**：`PublicWorkspaceProfile` 单对象（无信封包裹）。

**404**：workspace 不存在——`NOT_FOUND_WORKSPACE`（错误码总览 §23.3 已增补；命名对齐 `NOT_FOUND_*` 族）。

#### 端点三：`GET /v1/partner/orgs/{org_id}/workspaces`（Owner 名下列表）

- 依赖 Console 侧 org↔workspace 绑定（`csi_org_bindings`，org_id 为平台统一账户体系的不透明键，§4.2 第 6 项）。
- **200**：`{ "workspaces": [PublicWorkspaceProfile] }`——org 下全量返回，**不做分页**（一个 owner 的 workspace 数量为个位~十位级）。
- 无绑定/未知 org：200 + 空 `workspaces` 数组（非 404——空集是合法业务态）。

**消费方式自由**：M 可选投影模式（像 Console 投影 task 那样本地落一份、以 W2 事件 + since 增量维护），或直调渲染；我方不干涉。

### 21.3 W2：生命周期事件（Console → Marketplace webhook）

**边界澄清**：§20.1 的"事件订阅不进公测契约"指 M 侧事件总线（v2 候选）；本节是**点对点直连 webhook**（Console 调 M 提供的单一端点），不同物，契约内可承载。

- **端点**（Marketplace 提供）：`POST {M_BASE}/v1/webhooks/workspace/changed`
- **鉴权**：Console 出站凭证（Bearer + HMAC，§3 同款；M 侧按自己的入站守卫验签）
- **事件类型**：`workspace.created` / `workspace.updated` / `workspace.deleted`

> **无 `workspace.suspended`**：Console 侧 workspace 无 status 列，suspended 概念当前不存在；删除是真实生命周期终点（M 侧应停止展示与投递）。suspended 留待状态列引入时增补。

**payload 粒度：全量快照**（幂等 upsert 语义，免 delta 排序/丢失补偿问题；与 W1 详情同构）。

**信封**（§8.3 同构，`source` 为 `console`）：

```json
{
  "event_id": "0192…",
  "event_type": "workspace.updated",
  "event_version": 1,
  "occurred_at": "2026-09-04T08:00:00Z",
  "sent_at": "2026-09-04T08:00:01Z",
  "source": "console",
  "data": {
    "workspace": { "…": "PublicWorkspaceProfile 全量 10 字段，同 §21.2" }
  }
}
```

**deleted 事件形态**（仅标识，无档案——行已不存在）：

```json
{
  "event_id": "0192…",
  "event_type": "workspace.deleted",
  "event_version": 1,
  "occurred_at": "2026-09-04T08:00:00Z",
  "sent_at": "2026-09-04T08:00:01Z",
  "source": "console",
  "data": { "workspace_id": "0191…", "deleted_at": "2026-09-04T08:00:00Z" }
}
```

**触发点**：workspace 创建 / 档案更新（公开字段变更与否不区分——快照幂等，重复 upsert 无害）/ 删除（事务提交后异步推送）。

**投递语义（与 §3.4 的差异，重要）**：

| 维度 | 本节（C→M workspace 事件） | §3.4（M→C webhook 投递） |
|---|---|---|
| 语义 | **best-effort**：Console 侧进程内重试（5s/30s/2m 三段 + 60s 总预算），失败仅告警日志 | At-least-once + 5 次退避 + 死信表 |
| 去重 | M 侧按 `event_id` 去重（幂等键；`Idempotency-Key` 头 = `event_id` 同值双保险） | Console 按 `(event_id, event_type)` 去重 |
| 兜底 | **M 侧 W1 Pull**（`since` 水位增量）——丢事件的最终收敛通道 | Console 侧对账 + 死信告警 |

公测不建 C→M outbox（YAGNI）：可靠性由"M 侧去重 + Pull 兜底"闭合。M 侧 webhook 端点未就绪时，Console 侧事件推送可配置不启用（`CSI_MARKETPLACE_PARTNER_EVENT_PATH` 未配置 = 静默关闭），**不阻塞 W1 查询 API**。

### 21.4 W3：席位快照（submit_bid payload 增补）

场景二 `POST /v1/marketplace/tasks/{task_id}/bids`（§10.1）请求体**增补两个可选字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspace_name` | string（可省略） | 投标时点的 workspace 名称（反规范化快照） |
| `workspace_avatar_url` | string（可省略） | 投标时点的 workspace 头像引用（Console 存储原值：对象存储 URL 或站点相对路径；渲染级绝对地址以 W1 详情返回的 `avatar_url` 为准） |

- **向后兼容**：增量可选字段，M 侧旧消费者忽略即可；席位页免逐条调 W1 详情。
- **快照语义**：值为**投标时点**的档案（非查询时点）——席位页展示投标时刻的工作室门面，后续改名不回溯。

### 21.5 幂等 / 去重 / 兜底口径汇总

| 件 | 幂等 | 去重 | 兜底 |
|---|---|---|---|
| W1 三端点 | GET 天然幂等 | — | — |
| W2 三事件 | `event_id`（M 侧去重表 + `Idempotency-Key` 头） | M 侧按 `event_id` | M 侧 W1 Pull（`since` 增量） |
| W3 两字段 | 随宿主（§4.3 竞标幂等键 `(marketplace_task_id, bid_round, workspace_id)`） | 宿主 | — |

### 21.6 错误码增补

| 错误码 | HTTP | 可重试 | 场景 |
|---|---|---|---|
| `NOT_FOUND_WORKSPACE` | 404 | ❌ | W1 详情：workspace_id 不存在（§23.3 总览已同步） |

---

## 22. 决策记录

### 21.1 核心决策清单

| # | 决策点 | 选择 | 理由 |
|---|--------|------|------|
| 1 | 集成模式 | 混合模式（同步 RPC + 异步 Webhook） | 按场景匹配；不引入消息总线 |
| 2 | 超时触发归属 | 各管各的 | 每个超时有单一归属方，不打架 |
| 3 | 鉴权 | 服务级 Token + HMAC 签名 | 实现简单；不依赖额外基建；GitHub/Stripe 模式 |
| 4 | Webhook 投递 | At-least-once + 永久去重表 | 覆盖最长重试周期；兼作审计日志 |
| 5 | 幂等 | 组合（Idempotency-Key 头 + 业务自然键 DB UNIQUE） | 通用兜底 + 业务约束 |
| 6 | Pull 模式 | Console 主动调 Marketplace API + 游标增量拉取 | Console 完全掌控；不抹平 Push/Pull 语义差异 |
| 7 | 竞标席位满 | HTTP 409 Conflict | 资源状态冲突语义最贴切 |
| 8 | 选标通知 | 按 workspace 拆分 | 数据隔离；错误处理独立 |
| 9 | 实体模型 | 双侧（Marketplace=Order，Console=Project，通过 Opportunity 中介关联） | 关注点分离；关联本质走 Opportunity |
| 10 | project_id 生成 | Console 生成，反向 PATCH 回填 | Console 自主创建 Project；webhook ACK 快 |
| 11 | Spec 签约 | Project Task + @mention Comment 唯一真相源 | 复用 Multica 原生模型；消除工作流编排引擎；Agent 上下文天然一致 |
| 12 | 雇主回复 | Marketplace 收 Mention 通知 + 雇主回复 webhook 写回 Comment | Comment 唯一真相源在 Console；雇主无需访问 Console |
| 13 | 交付物存储 | 全存 Console（签名 URL） | Console 已有 Artifact Store；Marketplace 不承担大文件 |
| 14 | 修订协商 4 选项 | 统一 API + option 字段 | 减少端点爆炸 |
| 15 | Spec 变更判定 | Console 触发 24h 计时 | Agent Owner 侧治理 |
| 16 | 协商取消结算 | 提案-验证模式（Console 算，Marketplace 验证） | Console 持 Spec + Task；Marketplace 持资金 |
| 17 | 结算触发 | Console 主动 trigger | 独立 API 便于审计；Project 完成真相源在 Console |
| 18 | 错误码 | RFC 7807 + 业务扩展 | 标准化 + 业务语义 |
| 19 | 一致性 | 最终一致性 + 四层兜底 | 不引入 Saga/事件溯源；业务容忍可接受 |
| 20 | API 版本 | URL 路径版本 /v1/ | 显式可见；跨团队评审清晰 |

### 21.2 对 PRD 的实现映射

| PRD 章节 | PRD 业务表述 | 本契约技术实现 |
|---------|-------------|--------------|
| §5.1 商机投递 | Push / Pull / Manual 三种模式 | §9 三种模式 API |
| §5.2 商机幂等 | workspace_id + marketplace_task_id 唯一 | §4.3 业务幂等键 DB UNIQUE |
| §5.3 席位机制 | 席位满 72h 雇主决策 | §10.1 HTTP 409 + Marketplace 自检 72h |
| §5.6.2 选标 | 中标/未中标/全部驳回 | §11 按 workspace 拆分 webhook |
| §6.2 Project 创建 | 选标后自动创建 Project | §12 Console 自主创建 + 反向 PATCH |
| §6.3 Spec 签约工作流 | 发起对话/等待回复/提交 Spec 节点 | §13 Project Task + @mention Comment（替代工作流编排） |
| §6.3.3 兜底 | 澄清 5 轮 + 修订 3 轮 | §13.6 Spec 驳回 5 次 + 总时长 30 天（更宽松兜底） |
| §6.4 Spec 结构 | 字段表 | §13.4 Spec JSON payload |
| §6.5 Spec 确认 | 雇主确认/驳回/7 天超时 | §13.5 单一 webhook + event_type |
| §7.7 交付验收 | 提交/验收通过/驳回/要求修订 | §14 提交 API + 验收回调 webhook |
| §7.7.3 修订协商 | 4 选项 A/B/C/D + 2 天窗口 | §15 统一 decide API + 2 天超时默认 C |
| §9.4 自动验收 | 14 天 + G1/G2/G3/G6 通过 | §14.1 gates_status 字段 + Marketplace 14h 计时 |
| §9.6 Spec 变更 | 24h 判定 + 雇主二次确认 | §16 Console 24h 计时 + Marketplace 雇主确认 webhook |
| §9.6.1 协商取消 | 3 天响应 + 部分结算 | §17 完整 API 流程 + 里程碑权重公式 |
| §9.4 结算 | 验收通过触发付款 + 7 天申诉期 | §18 Console 主动 trigger + Marketplace 申诉期 webhook |

### 22.3 关键设计选择说明

**为何用 Project Task + @mention 替代 PRD §6.3 的工作流编排？**

PRD §6.3 用"发起对话节点/等待雇主回复节点/提交 Spec 节点"表述 Spec 签约流程，这是为了通俗易懂地表达业务流程。但技术实现上：

1. architecture-handoff.md §2.5 明确"不使用流程编排引擎"
2. PRD §6.3 的节点类型本质是编排引擎雏形，与核心哲学冲突
3. Multica 原生 Project Task + Comment + @mention 已能实现相同业务意图，且：
   - Agent 与 Agent Owner、Agent 与雇主的协作方式完全一致（都是 Comment）
   - Spec 是 Task 的自然交付物
   - Agent Owner 的 L3 干预天然就位
   - 消除"5 轮澄清 + 3 轮修订"的硬切分，改为更宽松的兜底（Spec 驳回 5 次 / 总时长 30 天）

**为何 Comment 唯一真相源在 Console，而非双向同步？**

1. Agent 的上下文 = Task Comment 流，雇主的回复必须天然进入这个流
2. 双向同步会有数据冗余和一致性问题
3. Marketplace 不需要存 Comment，只需要存"待雇主处理的 Mention 通知"
4. 雇主在 Marketplace 回复 Mention 通知，通过 webhook 写回 Console Comment — 对 Agent 来说与同事回复完全一致

**为何 project_id 由 Console 生成，而非 Marketplace？**

1. Console Project 持有执行层数据（Plan/Task），是 Console 内部职责
2. Project 创建是 Console 自主行为（由中标 webhook 触发）
3. Marketplace 在选标时生成 order_id，Console 创建 Project 后反向 PATCH 回填 project_id
4. 冗余字段缺失不影响主流程（关联本质走 Opportunity 中介）

---

## 22. 附录

### 22.1 API 总览表

| # | 场景 | Endpoint | Method | 方向 | 鉴权 | 幂等 | 超时 |
|---|------|----------|--------|------|------|------|------|
| 1 | 商机 Push | `/v1/webhooks/opportunity/pushed` | POST | M→C | Bearer+HMAC | event_id + 业务键 | 10s |
| 2 | 商机 Pull | `/v1/marketplace/tasks` | GET | C→M | Bearer+HMAC | GET 天然幂等 | 10s |
| 3 | 任务详情 | `/v1/marketplace/tasks/{task_id}` | GET | C→M | Bearer+HMAC | GET 天然幂等 | 5s |
| 4 | 提交竞标 | `/v1/marketplace/tasks/{task_id}/bids` | POST | C→M | Bearer+HMAC+Idem | 业务键 + Idem | 15s |
| 5 | 中标通知 | `/v1/webhooks/bid/result` | POST | M→C | Bearer+HMAC | event_id | 10s |
| 6 | 未中标通知 | `/v1/webhooks/bid/result` | POST | M→C | Bearer+HMAC | event_id | 10s |
| 7 | 全部驳回通知 | `/v1/webhooks/bid/result` | POST | M→C | Bearer+HMAC | event_id | 10s |
| 8 | 回填 project_id | `/v1/marketplace/orders/{order_id}` | PATCH | C→M | Bearer+HMAC+Idem | Idem | 10s |
| 9 | 推 Mention 通知 | `/v1/marketplace/orders/{order_id}/employer-mentions` | POST | C→M | Bearer+HMAC+Idem | mention_id + Idem | 10s |
| 10 | 雇主回复 Mention | `/v1/webhooks/task/employer-reply` | POST | M→C | Bearer+HMAC | event_id | 10s |
| 11 | 提交 Spec | `/v1/marketplace/orders/{order_id}/spec` | POST | C→M | Bearer+HMAC+Idem | 业务键 + Idem | 15s |
| 12 | Spec 雇主操作 | `/v1/webhooks/spec/employer-action` | POST | M→C | Bearer+HMAC | event_id | 10s |
| 13 | 提交交付物 | `/v1/marketplace/orders/{order_id}/deliverables` | POST | C→M | Bearer+HMAC+Idem | 业务键 + Idem | 15s |
| 14 | 验收回调 | `/v1/webhooks/delivery/employer-review` | POST | M→C | Bearer+HMAC | event_id | 10s |
| 15 | 启动修订协商 | `/v1/marketplace/orders/{order_id}/revision-negotiation/start` | POST | C→M | Bearer+HMAC+Idem | Idem | 10s |
| 16 | 修订协商决策 | `/v1/marketplace/orders/{order_id}/revision-negotiation/{negotiation_id}/decide` | POST | 双向 | Bearer+HMAC+Idem | Idem | 10s |
| 17 | 修订协商通知 | `/v1/webhooks/revision/negotiation-action` | POST | M→C | Bearer+HMAC | event_id | 10s |
| 18 | 雇主发起变更请求 | `/v1/webhooks/spec-change/request` | POST | M→C | Bearer+HMAC | event_id | 10s |
| 19 | 修订/新增判定 | `/v1/marketplace/orders/{order_id}/revision-requests/{request_id}/classify` | POST | C→M | Bearer+HMAC+Idem | request_id + Idem | 10s |
| 20 | 雇主二次确认 | `/v1/webhooks/spec-change/employer-confirmation` | POST | M→C | Bearer+HMAC | event_id | 10s |
| 21 | Spec 变更提案 | `/v1/marketplace/orders/{order_id}/spec-changes` | POST | 双向 | Bearer+HMAC+Idem | 业务键 + Idem | 15s |
| 22 | 确认 Spec 变更 | `/v1/marketplace/orders/{order_id}/spec-changes/{change_id}/confirm` | POST | 双向 | Bearer+HMAC+Idem | Idem | 10s |
| 23 | 拒绝 Spec 变更 | `/v1/marketplace/orders/{order_id}/spec-changes/{change_id}/reject` | POST | 双向 | Bearer+HMAC+Idem | Idem | 10s |
| 24 | 雇主发起取消 | `/v1/webhooks/project/cancel-request` | POST | M→C | Bearer+HMAC | event_id | 10s |
| 25 | Agent Owner 响应取消 | `/v1/marketplace/orders/{order_id}/cancel-requests/{request_id}/respond` | POST | C→M | Bearer+HMAC+Idem | request_id + Idem | 10s |
| 26 | 取消超时自动处理 | `/v1/marketplace/orders/{order_id}/cancel-requests/{request_id}/auto-resolve` | POST | C→M | Bearer+HMAC+Idem | Idem | 10s |
| 27 | 雇主对结算方案响应 | `/v1/webhooks/project/cancel-counter-response` | POST | M→C | Bearer+HMAC | event_id | 10s |
| 28 | 最终确认取消结算 | `/v1/marketplace/orders/{order_id}/cancel-requests/{request_id}/finalize` | POST | C→M | Bearer+HMAC+Idem | Idem | 10s |
| 29 | 取消协商结果通知 | `/v1/webhooks/project/cancel-resolution` | POST | M→C | Bearer+HMAC | event_id | 10s |
| 30 | 转纠纷 | `/v1/marketplace/orders/{order_id}/cancel-requests/{request_id}/to-dispute` | POST | C→M | Bearer+HMAC+Idem | Idem | 10s |
| 31 | 触发结算 | `/v1/marketplace/orders/{order_id}/settlement/trigger` | POST | C→M | Bearer+HMAC+Idem | 业务键 + Idem | 15s |
| 32 | 结算完成通知 | `/v1/webhooks/settlement/result` | POST | M→C | Bearer+HMAC | event_id | 10s |
| 33 | 纠纷发起通知 | `/v1/webhooks/project/dispute-raised` | POST | M→C | Bearer+HMAC | event_id | 10s |
| 34 | 申诉期关闭通知 | `/v1/webhooks/settlement/appeal-period-closed` | POST | M→C | Bearer+HMAC | event_id | 10s |
| 35 | 查询结算状态 | `/v1/marketplace/orders/{order_id}/settlement` | GET | C→M | Bearer+HMAC | GET 天然幂等 | 5s |
| 36 | 查询 Workspace 结算列表 | `/v1/marketplace/workspaces/{workspace_id}/settlements` | GET | C→M | Bearer+HMAC | GET 天然幂等 | 5s |
| 37 | 查询 Order 状态 | `/v1/marketplace/orders/{order_id}/status` | GET | C→M | Bearer+HMAC | GET 天然幂等 | 5s |
| 38 | 查询 Workspace Order 列表 | `/v1/marketplace/workspaces/{workspace_id}/orders` | GET | C→M | Bearer+HMAC | GET 天然幂等 | 5s |

> 方向：M→C = Marketplace 调 Console；C→M = Console 调 Marketplace；双向 = 任一方可发起
> 鉴权：Bearer = Bearer Token；HMAC = HMAC 签名；Idem = Idempotency-Key 头

### 22.2 Webhook event_type 总览

| event_type | Webhook Endpoint | 场景 |
|------------|-----------------|------|
| `opportunity.pushed` | `/v1/webhooks/opportunity/pushed` | 平台推送商机 |
| `bid.won` | `/v1/webhooks/bid/result` | 中标通知 |
| `bid.lost` | `/v1/webhooks/bid/result` | 未中标通知 |
| `bid.batch_rejected` | `/v1/webhooks/bid/result` | 全部驳回通知 |
| `task.employer_reply` | `/v1/webhooks/task/employer-reply` | 雇主回复 Mention |
| `spec.confirmed` | `/v1/webhooks/spec/employer-action` | 雇主确认 Spec |
| `spec.rejected` | `/v1/webhooks/spec/employer-action` | 雇主驳回 Spec |
| `spec.timeout` | `/v1/webhooks/spec/employer-action` | Spec 7 天超时自动取消 |
| `delivery.accepted` | `/v1/webhooks/delivery/employer-review` | 验收通过 |
| `delivery.rejected` | `/v1/webhooks/delivery/employer-review` | 验收驳回 |
| `delivery.revision_requested` | `/v1/webhooks/delivery/employer-review` | 要求修订 |
| `delivery.auto_accepted` | `/v1/webhooks/delivery/employer-review` | 14 天自动验收 |
| `revision.negotiation_started` | `/v1/webhooks/revision/negotiation-action` | 修订协商窗口启动 |
| `revision.negotiation_decided` | `/v1/webhooks/revision/negotiation-action` | 协商决策完成 |
| `revision.negotiation_auto_accepted` | `/v1/webhooks/revision/negotiation-action` | 协商 2 天超时默认 C |
| `spec_change.requested` | `/v1/webhooks/spec-change/request` | 雇主发起变更/修订请求 |
| `spec_change.employer_confirmed` | `/v1/webhooks/spec-change/employer-confirmation` | 雇主确认新增需求 |
| `spec_change.employer_rejected` | `/v1/webhooks/spec-change/employer-confirmation` | 雇主拒绝新增需求 |
| `project.cancel_requested` | `/v1/webhooks/project/cancel-request` | 雇主发起协商取消 |
| `project.cancel_counter_responseed` | `/v1/webhooks/project/cancel-counter-response` | 雇主对部分结算方案响应 |
| `project.cancel_resolved` | `/v1/webhooks/project/cancel-resolution` | 取消协商结果通知 |
| `project.dispute_raised` | `/v1/webhooks/project/dispute-raised` | 纠纷发起通知 |
| `settlement.completed` | `/v1/webhooks/settlement/result` | 结算完成通知 |
| `settlement.appeal_period_closed` | `/v1/webhooks/settlement/appeal-period-closed` | 申诉期关闭通知 |
| `workspace.created` | `/v1/webhooks/workspace/changed` | Workspace 创建（C→M，§21.3） |
| `workspace.updated` | `/v1/webhooks/workspace/changed` | Workspace 档案更新（C→M，§21.3） |
| `workspace.deleted` | `/v1/webhooks/workspace/changed` | Workspace 删除（C→M，§21.3） |

### 22.3 错误码总览

| 错误码 | HTTP | 可重试 | 场景 |
|--------|------|--------|------|
| `AUTH_TOKEN_INVALID` | 401 | ❌ | Bearer token 无效 |
| `AUTH_HMAC_SIGNATURE_MISMATCH` | 401 | ❌ | HMAC 签名校验失败 |
| `AUTH_TIMESTAMP_EXPIRED` | 401 | ❌ | timestamp 超 5min 窗口 |
| `VALIDATION_PAYLOAD_INVALID` | 400 | ❌ | payload 格式错误 |
| `VALIDATION_SPEC_SCHEMA_INVALID` | 422 | ❌ | Spec 结构不符合 PRD §6.4 |
| `VALIDATION_MILESTONE_WEIGHT_INVALID` | 422 | ❌ | 里程碑权重之和 ≠ 100% |
| `VALIDATION_GATE_NOT_PASSED` | 422 | ❌ | G1/G2/G3/G6 未通过 |
| `VALIDATION_INVALID_OPTION` | 422 | ❌ | option 不是 A/B/C/D |
| `VALIDATION_IDEMPOTENCY_CONFLICT` | 409 | ❌ | 同一 Idempotency-Key 但 payload 不同 |
| `NOT_FOUND_TASK` | 404 | ❌ | task_id 不存在 |
| `NOT_FOUND_ORDER` | 404 | ❌ | order_id 不存在 |
| `NOT_FOUND_PROJECT` | 404 | ❌ | project_id 不存在 |
| `NOT_FOUND_CANCEL_REQUEST` | 404 | ❌ | cancel_request_id 不存在 |
| `CONFLICT_SEAT_FULL` | 409 | ❌ | 席位已满 |
| `CONFLICT_SPEC_VERSION_CONFLICT` | 409 | ❌ | Spec version 已存在 |
| `CONFLICT_BID_ALREADY_SUBMITTED` | 409 | ❌ | 该 workspace 已在当前轮次竞标 |
| `CONFLICT_SUBMISSION_SEQ_CONFLICT` | 409 | ❌ | submission_seq 已存在 |
| `CONFLICT_SPEC_CHANGE_ALREADY_PROPOSED` | 409 | ❌ | 同一变更已提案 |
| `CONFLICT_SETTLEMENT_ALREADY_TRIGGERED` | 409 | ❌ | 已触发过结算 |
| `CONFLICT_PROCESSING_IN_PROGRESS` | 409 | ❌ | 同一幂等键正在处理中 |
| `STATE_OPPORTUNITY_NOT_BIDDABLE` | 422 | ❌ | 商机不可竞标 |
| `STATE_TASK_NOT_BIDDABLE` | 422 | ❌ | 任务不在招标中 |
| `STATE_WORKSPACE_NOT_ELIGIBLE` | 422 | ❌ | workspace 不可竞标 |
| `STATE_PROJECT_NOT_SPEC_SIGNING` | 422 | ❌ | Project 不在签约阶段 |
| `STATE_PROJECT_NOT_DELIVERABLE` | 422 | ❌ | Project 不在交付阶段 |
| `STATE_PROJECT_NOT_EXECUTING` | 422 | ❌ | Project 不在执行阶段 |
| `STATE_PROJECT_NOT_COMPLETED` | 422 | ❌ | Project 未完成 |
| `STATE_PROJECT_NOT_CANCELLABLE` | 422 | ❌ | Project 不可取消 |
| `STATE_SPEC_ALREADY_CONFIRMED` | 422 | ❌ | Spec 已确认 |
| `STATE_CANCEL_REQUEST_RESOLVED` | 422 | ❌ | 取消请求已处理 |
| `STATE_NEGOTIATION_NOT_ACTIVE` | 422 | ❌ | 协商窗口已关闭 |
| `RATE_LIMIT_EXCEEDED` | 429 | ✅ | 限流 |
| `UPSTREAM_MARKETPLACE_UNAVAILABLE` | 503 | ✅ | Marketplace 不可用 |
| `UPSTREAM_CONSOLE_UNAVAILABLE` | 503 | ✅ | Console 不可用 |
| `INTERNAL_DB_ERROR` | 500 | ✅ | 数据库错误 |
| `INTERNAL_UNKNOWN` | 500 | ✅ | 未知内部错误 |

---

> **文档结束**
>
> 本契约覆盖 CSI Agent Owner Console 与雇主侧/Marketplace 之间的全部 API 交互，共 42 个 endpoint（14 个 Console Webhook + 3 个 Console Partner 只读 API + 24 个 Marketplace API + 1 个 Marketplace 事件接收端点），覆盖 9 个业务场景 + 1 个场景外公共能力面（§21 Workspace 档案发现，2026-09-04 提案增补）。所有 API 均明确 endpoint、HTTP method、请求/响应 JSON Schema、鉴权方式、幂等性约定、超时处理规则、错误场景与错误码。
