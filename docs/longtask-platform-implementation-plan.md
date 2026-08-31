# CSI 长任务 — 平台侧阶段性落地实施方案

> **文档状态**：v1.0
> **日期**：2026-08-27
> **上游依据**：
>
> * 平台侧执行方案 [longtask-platform-execution-plan.md](./longtask-platform-execution-plan.md) v1.1（任务编号 T1\~T22+T16b+T19b 与此对齐）
>
> * 对接指南 v1.3（2026-08-27 快照）、`employer-integration-api.md`、PRD（附录 D 状态机权威）
>   **读者**：平台侧研发，拿到本方案即可按阶段开工

***

## 0. 落地总则

### 0.1 代码组织（新增，不动短任务线）

```
backend/src/longtask/                    # 长任务域（新建）
├── contract/                            # ① 契约底座（全阶段共用，第一批最先做）
│   ├── guards/hmac.guard.ts             #    Bearer + timestamp≤5min + nonce + HMAC 重算
│   ├── filters/rfc7807.filter.ts        #    RFC 7807 错误体 + error_code/retry_after_seconds
│   ├── errors/error-codes.ts            #    AUTH_*/VALIDATION_*/CONFLICT_*/STATE_*/RATE_LIMIT_*/UPSTREAM_*/INTERNAL_* + 可重试性
│   ├── webhook/webhook-outbox.entity.ts #    出站投递：event_id(uuid-v7) + 5 次退避 + 死信
│   ├── webhook/webhook-inbound.entity.ts#    入站去重：UNIQUE(event_id, event_type)
│   ├── webhook/webhook-dispatcher.service.ts
│   └── timers/timeout-scanner.service.ts#   统一超时扫描器 + 任务注册表
├── workspaces/                          # ② Workspace 投影（D1）
├── marketplace-tasks/                   # ③ 任务大厅（7 态 + 席位/轮次）
├── marketplace-bids/                    # ④ 席位竞标 + 综合分排序
├── marketplace-orders/                  # ⑤ 长任务订单（project_id 冗余）
├── settlements/                         # ⑥ 结算数据面（只备数据）
├── disputes/                            # ⑦ 长任务仲裁（平台侧完成）
└── longtask.module.ts                   #    统一注册 + app.module.ts 挂载
```

前端新增页面（`frontend/src/pages/`）：`LongTaskDetail.tsx`（选标/驳回/席位倒计时）、`WorkspaceShowcase.tsx`（展示页）、`LongTaskDisputes.tsx`（仲裁后台）；路由前缀 `/longtask`。

### 0.2 命名与口径

- 表名前缀 `marketplace_`，与短任务 `tasks/bids/orders` 完全隔离（D2）。
- **Workspace（AI 工作室）改造语义**：是平台侧既有卖方主体的升级——现有 Agent Owner（users）→ 运营 AI 工作室（workspaces.owner_user_id 绑定 users），名下 Agent（短任务 agentMarket）与长任务竞标/交付都以工作室为业务主体；展示页从现有 Agent 详情/导航进入，不是孤立的 /longtask 角落。
- 状态枚举走英文符号（契约陷阱 4）：`marketplace_tasks.status` 建议 `draft/open/selected/completed/expired/closed/cancelled`（落地前与 Console 对齐一次写入契约）。
- Opportunity 9 态是 **Console 侧实体**——平台只保留 `opportunity_dispatches` 投递日志，不建 Opportunity 表。
- 全部 C→M 接口挂路由 `/v1/marketplace/*`；出站统一走 outbox 投递器。

### 0.3 批次总览

| 批次  | 阶段      | 任务              | 启动条件                    |
| --- | ------- | --------------- | ----------------------- |
| 第一批 | 阶段一/二/三 | T1\~T16 + T16b  | 现在即可（Console M2/M3 已闭合） |
| 第二批 | 阶段四     | T17\~T19 + T19b | Console M4 闭合 + M5      |
| 第三批 | 阶段五     | T20\~T22        | M6 窗口（涉资金最后接）           |

***

## 1. 阶段一：底座（第一批 · T1\~T7）

### 1.1 目标

长任务线的数据模型与横切底座就绪，所有后续接口直接复用契约组件。

### 1.2 新建文件

| 文件                                             | 内容                                           |
| ---------------------------------------------- | -------------------------------------------- |
| `longtask.module.ts`                           | 域模块注册                                        |
| `workspaces/workspace.entity.ts`               | 见 §1.3 DDL                                   |
| `workspaces/workspaces.service.ts`             | CRUD + slug 唯一 + 展示页查询                       |
| `workspaces/workspaces.controller.ts`          | 展示页 API（内部，供前端）                              |
| `marketplace-tasks/marketplace-task.entity.ts` | 见 §1.3 DDL                                   |
| `contract/` 五个文件                               | HMAC 守卫 / RFC7807 过滤器 / 错误码 / outbox / 超时扫描器 |

### 1.3 建表（PostgreSQL，TypeORM + migration）

`workspaces` 表 DDL 见执行方案附录 A，此处从略。

```sql
CREATE TABLE marketplace_tasks (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- = marketplace_task_id
  employer_user_id     UUID,
  title                VARCHAR(255) NOT NULL,
  description          TEXT,
  category_id          VARCHAR(64),                  -- 平台类目树编码
  budget_min_cny       INT,
  budget_max_cny       INT,
  expected_delivery_at TIMESTAMPTZ,
  attachment_urls      TEXT[],
  tags                 TEXT[],
  status               VARCHAR(32) NOT NULL DEFAULT 'draft',
  seat_limit           INT NOT NULL DEFAULT 20,      -- 全局上限配置化（PRD §5.3）
  seat_taken           INT NOT NULL DEFAULT 0,
  expires_at           TIMESTAMPTZ,                  -- 任务有效期（默认发布+30 天）
  seat_full_deadline   TIMESTAMPTZ,                  -- 席位满 +72h 倒计时
  seat_full_locked_at  TIMESTAMPTZ,
  bid_round            INT NOT NULL DEFAULT 1,
  last_reopened_at     TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_outbox (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL,                       -- uuid-v7，重投不变
  event_type    VARCHAR(64) NOT NULL,
  target_url    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending/success/dead
  attempts      INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inbound_webhook_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL,
  event_type   VARCHAR(64) NOT NULL,
  payload      JSONB NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, event_type)                      -- 去重账本
);
```

### 1.4 横切组件实现要点

| 组件          | 关键规则                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| HMAC 守卫     | `Authorization: Bearer <token>` 比对 → timestamp ≤5min → nonce 唯一 → HMAC-SHA256(body+ts) 重算；token 走 K8s Secret 注入，7 天双发轮换                         |
| RFC7807 过滤器 | 统一 `type/title/status/detail/instance/request_id/error_code/details/retry_after_seconds`；`AUTH_*` 不可重试、`RATE_LIMIT_*/UPSTREAM_*/INTERNAL_*` 可重试 |
| outbox 投递器  | cron 每 10s 扫描；退避 `5s/30s/2min/10min/1h` 共 5 次；4xx 不重试进死信、5xx 重试；5 次失败 `status=dead` + 告警                                                        |
| 超时扫描器       | 统一 cron（5min）+ 注册表 `{key, dueAt, action}`；阶段二起陆续注册：`seat_full_deadline`、`expires_at`、spec 7d、验收 14d、协商 2d、驳回 5 次、签约 30d                         |
| 幂等键         | 9 项业务幂等键随各阶段建表时落 UNIQUE 约束（执行方案附录 B）                                                                                                            |

### 1.5 任务与验收

T1\~T7，验收标准见执行方案 §4 阶段一（`slug` 唯一、7 态枚举对齐、409/死信/竞态唯一、到点触发不越界）。

***

## 2. 阶段二：竞标闭环（第一批 · T8\~T14）

### 2.1 目标

打通「商机进 → 竞标出 → 中标回」最小业务闭环（Console M2 已闭合，可真实联调）。

### 2.2 建表

```sql
CREATE TABLE opportunity_dispatches (                -- 商机投递日志（非 Opportunity）
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_task_id  UUID NOT NULL,
  workspace_id         UUID NOT NULL,
  bid_round            INT NOT NULL,
  mode                 VARCHAR(16) NOT NULL,         -- push/pull/manual_assign
  event_id             UUID,                         -- push 出站 event_id（重投复用）
  pushed_at            TIMESTAMPTZ,
  UNIQUE (marketplace_task_id, workspace_id, bid_round, mode)
);

CREATE TABLE marketplace_bids (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_task_id  UUID NOT NULL,
  bid_round            INT NOT NULL,
  workspace_id         UUID NOT NULL,
  price_cny            INT NOT NULL,
  plan_summary         TEXT,
  estimated_delivery_at TIMESTAMPTZ,
  status               VARCHAR(32) NOT NULL DEFAULT 'submitted', -- submitted/won/lost/rejected
  source               VARCHAR(32) NOT NULL,         -- push/pull/manual_assign（平台推荐标签依据）
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (marketplace_task_id, bid_round, workspace_id)          -- 幂等键
);

CREATE TABLE marketplace_orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- = order_id
  project_id           UUID,                        -- Console 异步回填（PATCH）
  workspace_id         UUID NOT NULL,
  marketplace_task_id  UUID NOT NULL,
  bid_id               UUID,
  employer_user_id     UUID,
  final_price_cny      INT,
  contract_status      VARCHAR(32) DEFAULT 'signing',-- 与 Console Project 状态最终一致
  spec_snapshot        JSONB,
  spec_hash            TEXT,                         -- 仅按裁决口径记录/校验（§7-2）
  spec_version         INT NOT NULL DEFAULT 0,
  milestones           JSONB,                        -- [{key,weight,status}]；权重和=100%
  delivery_status      VARCHAR(32),
  settlement_status    VARCHAR(32),
  after_sale_deadline  TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);
```

### 2.3 核心服务逻辑

| 服务                        | 逻辑要点                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MarketplaceTasksService` | 7 态转移边（发布→open；关闭/过期→终态；重开→bid\_round+1 + 席位归档清零 + 清两个 seat\_full 字段（PRD 附录 D.1））；席位占用事务（`seat_taken+1` 原子；达 `seat_limit` → 写 `seat_full_locked_at/deadline` + urgent 通知 + 停收新竞标）                 |
| `BidsService`             | 提交竞标 = 事务{席位占位 + 插 bid}；席位满 → `409 CONFLICT_SEAT_FULL`；综合分 = `0.4×评分归一化 + 0.3×报价性价比 + 0.3×时效`（评分取 `workspaces.avg_rating`，历史<3 单取行业均值；报价低于同轮中位数 50% 反向扣分；24h 内提交时效满分）；默认按综合分排序 + 手动切换维度 + 分数不对外展示 |
| `SelectionService`        | 选标：winner bid=won + 任务→selected + 同轮其余→lost + 建 `marketplace_orders` + outbox `bid.won`；全部驳回：同轮已竞标→rejected + 重开 + outbox `bid.batch_rejected`；72h 到期 cron 自动全部驳回                                 |

### 2.4 接口实现（C→M）

| 端点                                          | 实现要点                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /v1/marketplace/tasks`                 | 供 Console 5min Pull；按 workspace/类目过滤；返回状态/席位余量/`bid_round`                               |
| `GET /v1/marketplace/tasks/{task_id}`       | 详情                                                                                       |
| `POST /v1/marketplace/tasks/{task_id}/bids` | HMAC 验签 + 幂等键 `(task_id,bid_round,workspace_id)` + 席位事务；确认后写 `opportunity_dispatches` 留痕 |
| `PATCH /v1/marketplace/orders/{order_id}`   | 收 `project_id` 回填；`UNIQUE(project_id)` 防重复；容忍为空窗口（bid.won 先 ACK 后异步）                     |

### 2.5 Webhook 投递（M→C，走 outbox）

* `bid.won` / `bid.lost` / `bid.batch_rejected` → Console `POST /v1/webhooks/bid/result`（event\_type 24 种之一；payload 信封对齐 `employer-integration-api.md` §8.3）。

* `bid.won` 发出后启动「回填观察」：30min 未见 `PATCH project_id` → 对账修复任务（调用 #37 核对）。

### 2.6 前端

* `LongTaskDetail.tsx`：雇主选标/全部驳回入口、席位满 72h 倒计时展示、竞标列表（综合分默认排序 + 手切）、平台推荐标签。

* `WorkspaceShowcase.tsx`：能力标签/服务承诺/案例（脱敏）/信用数据/公告/新店标识（PRD §5.6.7）。

### 2.7 任务与验收

T8\~T14（验收见执行方案 §4 阶段二）：三模式投递幂等、72h 自动驳回、选标联动、排序公式、契约替身 E2E（won/lost/驳回三路径）、展示页渲染。

***

## 3. 阶段三：签约闭环（第一批尾 · T15/T16/T16b）

### 3.1 前置动作：`spec_hash` 口径裁决

开本阶段第一个动作是与 Console 定 §6 陷阱 16：平台**不重算** `spec_content` 原始字节的 SHA-256；按裁决二选一（canonical JSON 规则写入契约 / hash 仅作记录）。在 `marketplace_orders` 上按最终口径处理 `spec_hash`。

### 3.2 接口与联动

| 项                                                          | 实现要点                                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/marketplace/orders/{order_id}/employer-mentions` | 接收 Console Mention → 站内通知雇主                                                                                                                                                                                                                       |
| `POST /v1/marketplace/orders/{order_id}/spec`              | 存 `spec_content` 原始字节 + `spec_hash`（按裁决口径）；校验里程碑权重和=100%（否则 400）；**启动 7 天计时**（注册进超时扫描器）                                                                                                                                                           |
| `POST /v1/webhooks/task/employer-reply` 投递（M→C）            | 雇主回复 → Console 写回 task\_comments                                                                                                                                                                                                                  |
| `POST /v1/webhooks/spec/employer-action` 投递（M→C）           | `spec.confirmed/rejected/timeout`；7 天到期未确认 → 发 `spec.timeout`（归属方=Marketplace）                                                                                                                                                                    |
| 7 天超时联动                                                    | 发 `spec.timeout` → `marketplace_orders` 取消 → 任务重开（`bid_round+=1` + 席位清零）                                                                                                                                                                          |
| Spec 驳回计数                                                  | 同 order 驳回 ≥5 → 进入协商取消入口（场景八，见 T16b）                                                                                                                                                                                                              |
| 场景八骨架 T16b                                                 | 实现 `cancel-requests/{id}/respond`（accept/reject；counter\_proposal 当前**固定返回 422** `COUNTER_PROPOSAL_UNSUPPORTED`，勿告警）、`auto-resolve`、`finalize`、`to-dispute` 四个 C→M；投递 `project/cancel-request`、`cancel-counter-response`、`cancel-resolution`（M→C） |

### 3.3 任务与验收

T15/T16/T16b：三路径（confirmed/rejected/timeout）E2E、重开联动断言、422 语义处理（验收标准见执行方案 §4 阶段三）。

***

## 4. 阶段四：验收闭环（第二批 · T17\~T19 + T19b）

> 启动条件：Console M4 闭合 + M5 交付（雇主验收域按裁决归 M5，`deliverables` 动作随 M5 就绪）。

### 4.1 接口与计时器

| 项                                                     | 实现要点                                                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/marketplace/orders/{order_id}/deliverables` | 收 metadata + 对象存储签名 URL（文件不走 HTTP body）；启动 **14 天验收计时** + 5/9/13 天催办（reminder，落 outbox/通知）                                                              |
| `POST /v1/webhooks/delivery/employer-review` 投递       | `delivery.accepted/rejected/revision_requested/auto_accepted`；14 天到期且三条硬约束满足 → `auto_accepted`（PRD §9.4）                                                |
| 修订协商                                                  | `revision-negotiation/start`（2 天计时）+ `decide`（4 选项，A/B 需双同意）+ 投递 `revision/negotiation-action`；窗口超时**默认 C**；完成后写 `after_sale_deadline=now()+7d`         |
| Spec 变更                                               | `spec-changes` + `confirm/reject`（3 天对方响应计时）；收 Console `revision-requests/{id}/classify` 结果后投递 `spec-change/employer-confirmation`；确认后 `spec_version+1` |
| 场景八完整链路 T19b                                          | M5 后放开 counter\_proposal 分支：`respond` 支持反提案 → 投递 `cancel-counter-response`；部分结算数据 = `Σ(verified_passed 里程碑权重 × final_price)`                            |

### 4.2 任务与验收

T17/T18/T19/T19b：14 天自动验收三约束、协商超时默认 C、`UNIQUE(project_id, change_seq)` 幂等、counter\_proposal 分支全链（验收标准见执行方案 §4 阶段四）。

***

## 5. 阶段五：结算与仲裁（第三批 · T20\~T22）

> 启动条件：M6 窗口；涉真实资金，最后接（D3：平台只备数据，划款交关联方）。

### 5.1 结算数据面（T20/T21）

| 项                                        | 实现要点                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `settlements` 表                          | `order_id`（UNIQUE，一个 Project 仅一次结算）、金额、里程碑明细（权重×final\_price，仅 `verified_passed`）、状态（`pending/settled/appeal_closed`） |
| 里程碑公式服务                                  | `Σ(权重 × final_price)`；Spec 提交时校验权重和=100%；不自行发明"按比例估算"（契约陷阱 8）                                                         |
| `POST .../settlement/trigger`            | 幂等 `UNIQUE(project_id)`；生成结算单数据 → **交结算支付版块（关联方执行划款）** → 等回写                                                          |
| `POST /v1/webhooks/settlement/result` 消费 | 收 `settlement.completed` → 更新 order/settlement 状态；7 天托管期由关联方执行，平台跟踪展示                                                 |
| 对账 #35/#36                               | `GET .../orders/{id}/settlement`、`GET /v1/marketplace/workspaces/{wid}/settlements` 供 Console 拉取                      |

### 5.2 长任务仲裁（T22）

| 项                  | 实现要点                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `disputes` 表（长任务域） | 纠纷发起 → 3 天举证窗口 → 7 天裁定（cron 提醒）→ 4 选项结果（取消/履约/部分结算/退款）                                       |
| 投递（M→C）            | `project/dispute-raised`（7 天申诉期内）、`dispute/arbitration-started`、`dispute/arbitration-result` |
| 接收（C→M）            | `disputes/{id}/evidence`（Agent Owner 举证）、`disputes/{id}/acknowledge`（终态确认——未获确认不得清重试上下文）     |
| 售后申诉期              | 进入「已完成」写 `after_sale_deadline=now()+7d`，到期投递 `settlement/appeal-period-closed` → Project 终态  |

### 5.3 任务与验收

T20/T21/T22：结算幂等与公式校验、`settlement.completed` 回写闭环、仲裁 4 选项资金动作数据齐全、终态双向确认（验收标准见执行方案 §4 阶段五）。

***

## 6. 测试与联调策略

1. **每阶段先替身后真实**：平台侧自建 Console 替身（mock 17 个 M→C 端点的收发行为），与 Console 侧 Marketplace 替身互为镜像；两批联调前先交换替身自测报告（对接指南 §7.2）。
2. **关键 E2E 场景**（以 `employer-integration-api.md` 时序为蓝本）：

   * 竞标三路径：bid.won / bid.lost / bid.batch\_rejected（含席位满 409、72h 超时驳回）

   * Spec 三路径：confirmed / rejected / timeout（含 7 天重开）

   * 验收路径：accepted / rejected / revision\_requested / auto\_accepted（14 天）

   * 协商路径：2 天超时默认 C；counter\_proposal（M5 后）

   * 结算/仲裁：settlement.completed 回写、4 选项、acknowledge 终态
3. **幂等与异常注入**：重复投递（event\_id 不变）、5xx 重试、死信告警、HMAC 错签/timeout 漂移、席位并发抢占。

***

## 7. 交付物与批次里程碑

| 批次  | 阶段  | 核心交付物                                                    | 验收门槛                                   |
| --- | --- | -------------------------------------------------------- | -------------------------------------- |
| 第一批 | 阶段一 | `contract/` 底座 + `workspaces/marketplace_tasks` 表 + 横切组件 | T1\~T7 验收全过                            |
| 第一批 | 阶段二 | 竞标闭环（席位/多轮/72h/选标/排序）+ 场景一二三 + 对账 #37/#38 + 展示页          | 与 Console 真实联调跑通竞标三路径                  |
| 第一批 | 阶段三 | 场景四 + 7 天重开 + 场景八骨架                                      | spec\_hash 已裁决；三路径 E2E；422 语义正确        |
| 第二批 | 阶段四 | 场景五六七 + 场景八完整链路                                          | 14 天自动验收 + 默认 C + counter\_proposal 全链 |
| 第三批 | 阶段五 | 结算数据面 + 仲裁                                               | settlement.completed 回写闭环；4 选项资金数据齐全   |

> 每批完成以「联调点」闭合为准（执行方案 §6.2）；未决项见执行方案 §7 风险清单（workspace 同步方式、spec\_hash 口径、结算备数据边界等）。

