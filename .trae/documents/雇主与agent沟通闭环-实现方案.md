# 雇主 ↔ Agent Owner / Agent 沟通闭环（CSI 页面侧）

## Context（为什么做）

选标完成后，Agent / Agent Owner 在 Console 的 Task Comment 里 `@employer` 提问（如截图里的「@Employer 你觉得这一版怎么样」），雇主需要能答复；同时雇主也要能主动发起消息。

按对接契约 `employer-integration-api.md` §13.1，「所有沟通（Agent ↔ Agent Owner ↔ Employer）都通过 Task Comment，Console DB 是唯一存储」。目前 M 侧链路已通一半：

- ✅ 入站：`POST /api/v1/longtask/contract/orders/:id/employer-mentions` → 落库 `employer_mentions`（[marketplace-contract.controller.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/contract/marketplace-contract.controller.ts#L140-L147)）
- ✅ 雇主读/回：`GET /:id/mentions`、`POST /:id/mentions/:mentionId/replies`（[employer-marketplace-orders.controller.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/marketplace-orders/employer-marketplace-orders.controller.ts#L251-L281)）
- ✅ 出站回复：`notifyEmployerReply` → `task.employer_reply` webhook

**缺口**：
1. 前端零沟通 UI —— 全站搜 `mention` 无命中，雇主看不到提问也无法回复（截图页面 [EmployerOrderDetail.tsx](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/frontend/src/pages/EmployerOrderDetail.tsx) 没有任何沟通区块）。
2. 无「雇主主动发起」通道 —— 契约 §13.3 的 `employer-reply` 强制带 `mention_id` + `in_reply_to_comment_id`，只能表达「回复已有提问」。

**已确认决策**：主动发起复用 `task/employer-reply`（两字段允许 `null` = Console 新开顶层 Comment）；界面内嵌订单详情页；仅服务雇主侧，不给承接方做镜像视图。

---

## 实现步骤

### 1. 新增出站消息表（不动 `employer_mentions`）

`employer_mentions` 的 `mention_id uuid NOT NULL UNIQUE` 是入站语义，被 `receiveEmployerMention` 的幂等、以及 404/422 语义依赖，不复用。新增：

**新建** `backend/src/longtask/marketplace-orders/employer-outbound-message.entity.ts`，表 `employer_outbound_messages`：
`id uuid PK` / `order_id uuid` / `project_id uuid?` / `project_task_id uuid?` / `employer_user_id uuid?` / `client_message_id uuid NOT NULL`（幂等键，前端生成）/ `from_type varchar(32) default 'employer'` / `from_display_name varchar(255)?` / `content jsonb` / `addressees jsonb?` / `status varchar(16) default 'queued'` / `created_at timestamptz`

**双处注册**（漏一处生产启动崩溃，见既有教训）：
- [app.module.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/app.module.ts) `entities[]`
- [longtask.module.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/longtask.module.ts#L62-L78) `forFeature[]`（`EmployerMention` 在 L74 旁）

**DDL**：生产 `synchronize: process.env.DB_SYNC === 'true'` 为 false（[app.module.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/app.module.ts#L251)），必须显式建表。按既有惯例追加进 [longtask-schema-sync.js](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/scripts/longtask-schema-sync.js#L26) 的 `DDL[]`（该脚本现有 13 表、**不含 `employer_mentions`**）：

```sql
CREATE TABLE IF NOT EXISTS employer_outbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL, project_id UUID, project_task_id UUID,
  employer_user_id UUID, client_message_id UUID NOT NULL,
  from_type VARCHAR(32) NOT NULL DEFAULT 'employer', from_display_name VARCHAR(255),
  content JSONB NOT NULL DEFAULT '{}', addressees JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS uq_employer_outbound_client_msg ON employer_outbound_messages(client_message_id);
CREATE INDEX IF NOT EXISTS idx_employer_outbound_order ON employer_outbound_messages(order_id);
```

### 2. Service（改动集中在 [spec-contract.service.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/marketplace-orders/spec-contract.service.ts)）

复用文件内已有的 `readString/readOptionalUuid`（L455-488）与 `getOrThrow`（L441-451）。

- `sendEmployerMessage(orderId, input)`：
  - 校验：`text` trim 非空且 ≤4000，否则 400 `VALIDATION_INVALID_PAYLOAD`；`attachments` 非数组 → 400；`client_message_id` 提供了但非 uuid → 400。
  - `order.projectId` 为 null → **422 `STATE_INVALID_TRANSITION` 且不发 webhook**（避免 Console 400 打进死信，参照 `spec_change.*` 教训）；`contractStatus === 'cancelled'` → 422。
  - 幂等：先按 `clientMessageId` findOne，命中直接返回 `duplicate: true` 且不重复 enqueue；并发由唯一索引兜底（catch 后回读，写法同 `receiveEmployerMention` L196-201）。
  - 落库后 enqueue，**显式传 eventId = 行 id**（`dispatcher.enqueue` 第 4 参已支持，见 [webhook-dispatcher.service.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/contract/webhook-dispatcher.service.ts#L72-L101)），保证 DLQ replay 同一 id。
- `listEmployerThread(orderId)`：合并时间线（ASC）
  - 入站 mention → `direction:'inbound', kind:'question'`
  - `mention.reply` 展开成合成项 → `direction:'outbound', kind:'reply'`，时间取 `repliedAt`（回复不是独立行，存在 jsonb 里）
  - `employer_outbound_messages` → `direction:'outbound', kind:'message'`
- 抽私有 `enqueueEmployerReply(data, eventId?)` 供「回复」与「主动发起」共用（现有 `notifyEmployerReply` L411-439 改造）。

### 3. 出站 payload（关键：null 语义）

主动发起时：`mention_id: null`、`source_comment_id: null`、`in_reply_to_comment_id: null`、`project_task_id: <最近入站 mention 的 projectTaskId ?? null>`；
回复时保持原样（`mention_id` + `in_reply_to_comment_id = mention.sourceCommentId`）。

两条路径都补：`message_id`、`initiated_by: 'employer'`、`workspace_id: order.workspaceId`、`marketplace_task_id: order.marketplaceTaskId`（向后兼容）。

**addressee 务实结论**：新订单可能还没有任何入站 mention，M 侧拿不到 Console 的 agent/owner uuid，因此只传语义提示 `addressees: [{type:'agent_owner'}]`，**具体人由 C 侧按 `workspace_id` / `project_id` 反查**（Console 才是 Project Task + Comment 真相源）。这一条必须写进对接说明。

### 4. Controller

在 [employer-marketplace-orders.controller.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/marketplace-orders/employer-marketplace-orders.controller.ts#L251) 的 `listMentions` 之后新增，沿用 `@UseGuards(AuthGuard)` + `assertOrderEmployer`：

- `POST /api/v1/longtask/employer/orders/:id/messages`，body `{ text, attachments?, client_message_id?, addressees? }`
- `GET  /api/v1/longtask/employer/orders/:id/messages` → `{ items: EmployerThreadItem[] }`

选独立端点而非塞进 `detail`：轮询只拉消息，不重跑 detail 的 6 个查询、也不触发 `claimEmployer` 写库。旧 `/mentions` 端点保留不动。

### 5. 前端

**[longtaskApi.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/frontend/src/api/longtaskApi.ts)**（在 L578 附近，复用 `requestJson`）：新增类型 `EmployerThreadItem`（`direction/kind/text/from/attachments/createTime/status`）+ 函数 `listEmployerOrderMessages`、`sendEmployerOrderMessage`、以及**当前完全缺失的** `employerReplyMention`。

**新建** `frontend/src/components/longtask/EmployerOrderChat.tsx`（自取数：自带 loading/error/空态/轮询，页面 `load()` 不动）：
- 时间线 ASC：入站提问左侧 `bg-[var(--background-100)]` + 「待你回复」徽标 + 内联回复框；已回复缩进显示「你（雇主）」；主动发起右对齐 `bg-[var(--brand-50)]`。
- 输入区 textarea + `btn-cs btn-primary min-h-11`，`disabled={busy || !text.trim()}`；`clientMessageId` 用 ref 生成一次，失败重试复用同值。
- 遵守前端硬性约定：loading 用共享 `Skeleton`（容器 `aria-busy="true"`）、error 态给「重试」按钮、禁止硬编码色值、时间统一 `toLocaleString()`、附件只渲染 name + `<a target="_blank" rel="noreferrer">`（同 `DeliveryCard` L792-806 风格）。
- 轮询 30s + `document.visibilityState === 'visible' && !busy` 守卫，cleanup `clearInterval`（模式参照 `TaskDetail.tsx:189-197`）。

**修改** [EmployerOrderDetail.tsx](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/frontend/src/pages/EmployerOrderDetail.tsx)：在「交付物与验收」区块前挂 `<EmployerOrderChat token={token} orderId={order.id} />`。

### 6. C 侧对接说明（新增文档）

`csi-longtask business-docs/design/雇主主动发起消息-C侧对接说明.md`：字段表、null 语义（新开顶层 Comment / 不挂旧评论）、按 `project_id` 反查 `project_task`、按 `workspace_id` 反查 addressee、按 `event_id` 幂等（`webhook_outbox.event_id` 无唯一约束，重复投递是真实现象，**C 侧必须去重**）、`message_id` 建议回写、合法 payload 必须返 2xx。

---

## 验证

**单测**
- [spec-contract.service.spec.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/marketplace-orders/spec-contract.service.spec.ts)：补 `getRepositoryToken(EmployerOutboundMessage)` mock，用例覆盖 —— 主动发起落库并 enqueue（断言 `mention_id:null` / `in_reply_to_comment_id:null` / `addressees:[{type:'agent_owner'}]` / 第 4 参 eventId）、同 `client_message_id` 幂等不重复 enqueue、空 text → 400、非 uuid → 400、`projectId:null` → 422 且未 enqueue、cancelled → 422、`listEmployerThread` 合并排序与 reply 展开。
- 新建 `employer-marketplace-orders.controller.spec.ts`（当前不存在）：纯 mock 断言委托，风格同 `marketplace-contract.controller.spec.ts:123-128`。
- 命令：`cd backend && npx jest src/longtask/marketplace-orders && npx jest src/longtask/contract`（回归）。

**前端**：`cd frontend && npx eslint src/pages/EmployerOrderDetail.tsx src/api/longtaskApi.ts src/components/longtask/EmployerOrderChat.tsx`（0 报错，不带 `--fix`）→ `npm run build` 成功。

**联调（线上）**
1. 执行 DDL：`node backend/scripts/longtask-schema-sync.js`，核对 `employer_outbound_messages: exists=true`。
2. `cd backend && npm run build` **后再** `docker build`（Dockerfile 用预构建 dist，否则静默发布旧代码），重建 `-p 4001:4000` 并验 `/health`。
3. 触发一次 Agent `@employer` 提问 → CSI 订单详情页出现提问 → 雇主回复 → 查 `employer_mentions.status='replied'`，并核对 Console 侧 `comment` 表新增 `source='employer_reply'` 行（SQL 见 C 侧文档第 8 节）。
4. 雇主主动发起一条 → 查 `employer_outbound_messages` 有行、`webhook_outbox` 该 event 非 dead；C 侧确认收到新顶层 Comment。

---

## 风险与注意

- `webhook_outbox.event_id` 无唯一约束 → at-least-once 下重复投递会真实发生，C 侧去重是验收前提，必须写清。
- 主动发起若在 `projectId` 为空的订单上执行，Console 会返 400（历史 `spec_change.*` 死信就是缺 `project_id` 导致），所以前置 422 拦掉。
- 新 entity 必须同时注册在 `app.module.ts` 与 `longtask.module.ts`，并且测试模块要提供 mock provider，否则 Nest DI 解析失败。