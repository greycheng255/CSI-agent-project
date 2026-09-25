# C 侧对接说明：雇主 ↔ Agent / Agent Owner 沟通通道（双向）

> 提出方：M 侧（genesis-backend / Marketplace）
> 面向：Console（csi-beta-server，multica fork）开发同事
> 依据：`employer-integration-api.md` §13.1 / §13.2 / §13.3；承接《C 侧修改需求-澄清等待回路与雇主Mention回传.md》第 6 节
> M 侧实现：`marketplace-contract.controller.ts`（入站）、`employer-marketplace-orders.controller.ts`、`spec-contract.service.ts`（`receiveEmployerMention` / `sendEmployerMessage` / `enqueueEmployerReply`）
> 版本：v3（2026-09-25：扩写为双向通道说明；同日晚补 `STATE_PROJECT_NOT_SPEC_SIGNING`(422) 与 `VALIDATION_IDEMPOTENCY_CONFLICT`(409) 的实现，见 §3.5。文件名沿用「雇主主动发起消息」以保持既有链接可用）

---

## 1. 全景：三个发起方、两条通道

§13.1 已约定「所有沟通（Agent ↔ Agent Owner ↔ Employer）都通过 Task Comment，Console DB 是唯一存储」。落地上有**三个发起方**，走**两条通道**：

| # | 发起方 | 方向 | 通道 | C 侧要做的事 | 章节 |
|---|---|---|---|---|---|
| 1 | 雇主 —— 回复已有提问 | M→C | `POST /v1/webhooks/task/employer-reply`（带 `mention_id` + `in_reply_to_comment_id`） | 把回复写进原评论线程 | §2 / §4.1 |
| 2 | 雇主 —— 主动开新话题 | M→C | 同上，三个 id 字段全为 `null` | 新开一条**顶层** Comment | §2 |
| 3 | **Agent / Agent Owner** | **C→M** | `POST /v1/marketplace/orders/{order_id}/employer-mentions` | **由你侧主动推送**；这是雇主能看到 Agent 发言的唯一入口 | §3 / §4.2 |

闭环（缺任何一环雇主侧都会「看不见」）：

```
Agent/Owner 在 Console 发言
   └─(3) employer-mentions 推送──────► M 落库 employer_mentions(pending) ──► 雇主时间线出现
                                                                                 │
雇主在 CSI 页面回复 ◄────────────────────────────────────────────────────────────┘
   └─(1) employer-reply 写回────────► Console 写入原评论线程

雇主在 CSI 页面主动开新话题
   └─(2) employer-reply 顶层 Comment─► Console 建顶层 Comment
        └─ Agent/Owner 在该 Comment 下回复 ──(3) 必须回推 employer-mentions ──► 回到最上面
```

> **v3 新增的重点**：路径 3 原本只写在总契约 §13.2，本文档补齐其实测口径；并明确 **路径 2 之后的 Agent 回复必须经路径 3 回推**（原文档缺失此项，会导致「雇主开了话题却永远收不到回应」）。

### 1.1 为什么路径 2 复用 §13.3 而不新增 webhook

§13.3 定义的 `employer-reply` **强制带 `mention_id` + `in_reply_to_comment_id`**，只能表达「回复已有提问」；雇主想主动开一个新话题（例如补充需求、催进度）时没有 mention 可引用。

M 侧因此**复用同一个 webhook 路径**：

```
POST /v1/webhooks/task/employer-reply
event_type: task.employer_reply
```

区别只在三个字段的取值：主动发起时 `mention_id`、`source_comment_id`、`in_reply_to_comment_id` **全部为 `null`**，语义 = **新开一条顶层 Task Comment（不挂到任何旧评论下）**。

> 这样 C 侧只需在现有接收端加一个 `null` 分支，无需新增路由、鉴权与幂等逻辑。

---

## 2. 方向一：雇主发起（M→C）

覆盖路径 1（回复提问）与路径 2（主动开新话题）。信封（`event_id`/`event_type`/`event_version`/`occurred_at`/`sent_at`/`source`）由 M 侧 dispatcher 统一补齐，与现有 `employer-reply` 逐字一致。

### 2.1 主动发起（路径 2）：请求体（`data` 字段）

```json
{
  "event_id": "<= 出站消息行 id，见 §5 幂等>",
  "event_type": "task.employer_reply",
  "event_version": 1,
  "occurred_at": "2026-09-25T02:10:00.000Z",
  "sent_at": "2026-09-25T02:10:00.000Z",
  "source": "marketplace",
  "data": {
    "mention_id": null,
    "source_comment_id": null,
    "in_reply_to_comment_id": null,
    "project_task_id": "e1a0b6c2-…",
    "task_id": "e1a0b6c2-…",
    "marketplace_comment_id": "0f9c2a1e-…",
    "project_id": "eafebb49-…",
    "order_id": "564df59f-…",
    "workspace_id": "1c5c30eb-…",
    "marketplace_task_id": "8a23d024-…",
    "message_id": "0f9c2a1e-…",
    "initiated_by": "employer",
    "from": { "type": "employer", "id": "b8fb3908-…", "display_name": "用户24565" },
    "content": "请补充移动端适配的说明",
    "attachments": [],
    "addressees": [{ "type": "agent_owner" }],
    "sent_at": "2026-09-25T02:10:00.000Z"
  }
}
```

> **2026-09-25 联调实测修订（重要）**：以上 `content` / `task_id` / `marketplace_comment_id` 三处已按 **Console 线上校验的实际要求** 调整，
> 探测证据（对 `POST /v1/webhooks/task/employer-reply` 逐字段试错）：
> 1. `content` 传对象 → `400 VALIDATION_PAYLOAD_INVALID`，`detail: json: cannot unmarshal object into Go struct field employerReplyPayload.content of type string`
> 2. 去掉 `addressees` 仍报同错 → 与 `addressees` 无关
> 3. `content` 改字符串后 → `400 … requires workspace_id, marketplace_task_id, task_id and content`
> 4. 补 `task_id` 后 → `400 … requires marketplace_comment_id (idempotency key)`
> 5. 再补 `marketplace_comment_id` → **`200 {"accepted":true,"message":"processed"}`**（同 `marketplace_comment_id` 重放同样 200）
>
> M 侧现已按此发送，实测 `webhook_outbox.status=success`。
> ⚠️ 注意本分支与「回复提问」分支**不可混用同一结构**：回复分支的 `content` 仍是 `{text, attachments}` 对象且不要求 `task_id`（该分支线上一直 200）。
> 若你侧希望两个分支统一，请告知，M 侧可改。缺少 `task_id`（订单尚无入站提问）时 M 侧现在**前置返回 422、不投递**，不会再把 400 打进死信。

### 2.2 字段说明

| 字段 | 主动发起（路径 2） | 回复提问（路径 1） | 说明 |
|---|---|---|---|
| `mention_id` | **`null`** | 原提问 mention id | `null` 即「非回复」|
| `source_comment_id` | **`null`** | 原提问评论 id | — |
| `in_reply_to_comment_id` | **`null`** | = `source_comment_id` | **`null` → 建顶层 Comment，不做 threading** |
| `content` | **字符串**（消息正文） | `{text, attachments}` 对象 | 主动发起分支必须是字符串，见上方实测修订 |
| `task_id` | **`project_task_id` 同值** | 不入参 | Console 顶层 Comment 必填；缺则 400 |
| `marketplace_comment_id` | **出站消息行 id** | 不入参 | Console 侧幂等键；与 `message_id` 同值 |
| `project_id` | 订单 project_id | 同 | M 侧保证非空（见 §7 拦截） |
| `project_task_id` | Console 侧任务 id（取自最近一条入站提问） | 同 | **M 侧保证非空**（缺失时 422 不投递） |
| `workspace_id` / `marketplace_task_id` | 订单上的工作室 / 任务 id | 同 | **新增字段**，供你侧反查与对账 |
| `message_id` | 出站消息行 id | 入站 mention 行 id | **新增字段**，建议回写关联 |
| `initiated_by` | `employer` | `employer` | **新增字段**，用于分流 |
| `addressees` | `[{ "type": "agent_owner" }]` | 不入参（可缺省） | **仅语义提示，见 §6.1** |
| `attachments` | 数组（可空） | 在 `content` 内 | 实测 Console 容忍该字段 |

---

## 3. 方向二：Agent / Agent Owner 发起（C→M）

**这条通道 M 侧已实现且已通过联调**（此前只写在总契约 §13.2，本节为实测口径）。

### 3.1 接口与鉴权

```
POST /v1/marketplace/orders/{order_id}/employer-mentions
```

| 项 | 值 |
|---|---|
| 鉴权 | `Authorization: Bearer <LONGTASK_INBOUND_TOKEN>` **且** `X-Signature: t=<unix_ts>,v1=<hmac_sha256(rawBody + ts) hex>` |
| 签名密钥候选 | `LONGTASK_INBOUND_HMAC_SECRET` → 命中的 Bearer 本身（单密钥口径）→ 旧专用密钥（过渡兼容） |
| 时间戳 | 漂移窗口 **±300s**（`AUTH_TIMESTAMP_EXPIRED`） |
| 防重放 | `X-Request-Id`（nonce，≤64 字符；`hmac_nonces` 落库，TTL 10min）。**重试必须换新的 `X-Request-Id`**，复用会被判重放而 401 |
| 超时 | 10s |

### 3.2 请求体（实测核准的必填/可选）

```json
{
  "mention_id": "uuid",
  "project_id": "uuid",
  "project_task_id": "uuid",
  "source_comment_id": "uuid",
  "from": { "type": "agent_owner", "id": "uuid", "display_name": "张三" },
  "content": {
    "text": "@employer 请问登录功能是否需要支持微信 OAuth？",
    "attachments": [{ "name": "需求分析草案.pdf", "url": "https://…", "type": "pdf" }]
  },
  "related_spec_id": null,
  "related_spec_version": 2,
  "reply_endpoint_hint": "https://console.../v1/webhooks/task/employer-reply",
  "sent_at": "2026-09-25T02:10:00Z"
}
```

| 字段 | 必填 | 实测行为 |
|---|---|---|
| `mention_id` | **必填** | uuid；**幂等去重键**。缺失 → 400；非 uuid → 400 |
| `content.text` | **必填** | 缺失 → 400；非空字符串 |
| `content.attachments` | 可选 | 数组，缺省 `[]` |
| `from.type` | 可选 | `agent` / `agent_owner`；缺省按 `agent`。雇主侧优先显示 `display_name`，无则显示「Agent」/「Agent Owner」 |
| `from.id` | 可选 | uuid。**非 uuid 会 400**（历史缺口：曾直落 uuid 列触发 PG `22P02` → 500，已修为 400） |
| `project_id` | 可选 | 缺省回退订单上的 `project_id` |
| `project_task_id` | 可选 | **强烈建议每次都带**——M 侧「雇主主动发起」需要它（取最近一条入站提问的值，见 §7） |
| `source_comment_id` | 可选 | 该提问对应的 Console 评论 id。**雇主回复时 M 会用它做 threading**（见 §4.1），建议带 |
| `related_spec_id` / `related_spec_version` | 可选 | 关联 Spec，原样落库 |
| `reply_endpoint_hint` | 可选 | 原样落库，供排查 |
| `sent_at` | 可选 | ISO 时间 |

### 3.3 幂等

- **业务去重键 = `mention_id`**（库内唯一）。同一 `mention_id` 重复推送：**不新增行、不重复通知**，返回 `duplicate=true`。
- 并发同 `mention_id` 由唯一约束兜底：冲突后回读既有行，同样按重复返回（对端不会看到 500）。
- `X-Request-Id` 是**防重放 nonce**，与业务幂等无关：真实重试请换新值。

### 3.4 响应

```http
201 Created
{ "ok": true, "mention_id": "uuid", "received_at": "2026-09-25T02:10:01Z", "duplicate": false }
```

重复推送返回同结构、`duplicate=true`。

### 3.5 错误场景（按 M 侧实际实现）

| HTTP | code | 场景 |
|---|---|---|
| 400 | `VALIDATION_INVALID_PAYLOAD` | `mention_id` 缺失/非 uuid；`content.text` 缺失；`from.id` 非 uuid；可选 uuid 字段格式非法 |
| 404 | `NOT_FOUND_ORDER` | `order_id` 不存在 |
| 422 | `STATE_PROJECT_NOT_SPEC_SIGNING` | 订单 `contract_status` **不在签约阶段**（仅 `signing` / `awaiting_confirmation` 受理；`signed`、`cancelled` 等一律 422） |
| 409 | `VALIDATION_IDEMPOTENCY_CONFLICT` | 同一 `mention_id` 但 **payload 不同**（判定口径见下） |
| 401 | `AUTH_TOKEN_INVALID` / `AUTH_HMAC_SIGNATURE_MISMATCH` / `AUTH_TIMESTAMP_EXPIRED` / `AUTH_NONCE_MISSING` | 鉴权、签名、时间戳、nonce 任一不通过 |

**409 的判定口径**：M 侧只比对 `order_id` 与 `content.text`（两侧均 `trim` 后比较）。`sent_at`、`attachments`、`from`、以及未知字段**不参与**比对——合法重试时这些可能被重新序列化或省略，若一并比对会把**正常重试误判为冲突**。

> 对 C 侧的可操作结论：**同一 `mention_id` 重试时，请保持 `content.text` 与首次一致**（其余字段可变）。
> 若确实需要修改提问正文，请改用**新的 `mention_id`**——沿用旧键改正文会得到 409，且新正文**不会**被受理。

**签约阶段的判定口径**（M 侧 `SPEC_SIGNING_STAGES`）：

| `contract_status` | 含义 | 是否受理 |
|---|---|---|
| `signing` | 选标成功，待提交 Spec | ✅ |
| `awaiting_confirmation` | 已提交 Spec，待雇主确认 | ✅ |
| `signed` | Spec 已签署，进入交付期 | ❌ 422 |
| `cancelled` | 订单已取消 | ❌ 422 |

> **幂等优先于阶段校验**：已受理过的 `mention_id` 再次推送，即使订单此时已推进到 `signed`，仍返回 `duplicate=true`（不会变成 422）——保证 at-least-once 重试语义。
> 若你侧在交付期也需要向雇主提问，请告知，M 侧可放宽 `SPEC_SIGNING_STAGES`。

> ⚠️ **与总契约 §13.2 的差异（请以本节为准）**：§13.2 列出的 `STATE_PROJECT_NOT_SPEC_SIGNING`（422）与 `VALIDATION_IDEMPOTENCY_CONFLICT`（409）**均已实现**（2026-09-25 补，口径见上）；`CONFLICT_PROCESSING_IN_PROGRESS`（409）**仍未实现**——M 侧不做「同幂等键在途」判定，并发由 `mention_id` 唯一约束兜底（结果是不重复落库，而非返回 409）。若你侧依赖该语义，请告知。
> 另注：总契约 §6.4 要求调用方在收到该码后「延后重试」，但 §5.3/§22.3 又把 `CONFLICT_*` 标为不可重试——两处自相矛盾，建议一并澄清。
>
> ⚠️ §13.2 提到的 `Idempotency-Key` 头 M 侧**不读取**，去重完全依赖 `mention_id`。

### 3.6 M 侧收到后的处理

1. 落库 `employer_mentions`，`status='pending'`，`content={text, attachments}`。
2. **best-effort 渠道通知**给雇主（微信公众号模板消息；无 openid / 未配模板时仅站内可见，**不阻断**你的推送，也不会因为你侧 payload 问题而报错给你）。
3. 雇主在 CSI 页面看到该提问（`kind=question`），可直接回复。

---

## 4. 回流闭环（本版新增的关键要求）

### 4.1 雇主回复入站提问（路径 1）

雇主回复后，M 侧出站 `employer-reply` 的取值：

| 字段 | 值 |
|---|---|
| `mention_id` | 被回复的 mention id |
| `source_comment_id` | 该 mention 的 `source_comment_id` |
| `in_reply_to_comment_id` | = `source_comment_id` |

→ C 侧应把该回复写入原评论线程（threading）。

### 4.2 Agent / Agent Owner 回复「雇主主动开的顶层 Comment」（⚠️ 必须实现）

雇主主动开的顶层 Comment **没有 `mention_id`**（见 §2.1）。因此：

> **当 Agent / Agent Owner 在该 Comment 下回复时，C 侧必须再推一条 `employer-mentions`**，否则雇主侧**永远看不到任何回应**，闭环断裂。

回推时的取值：

| 字段 | 值 | 理由 |
|---|---|---|
| `mention_id` | 新 uuid | 幂等去重键 |
| `from.type` | `agent` / `agent_owner` | 雇主侧据此显示「Agent / Agent Owner」 |
| `from.id` / `from.display_name` | Agent / Owner 的 uuid 与名称 | — |
| `source_comment_id` | **该 Agent 评论自身的 id** | 雇主再次回复时，M 会以它为 `in_reply_to_comment_id` 挂回该评论（保持线程一致） |
| `project_task_id` / `project_id` | 同一 Project Task / Project | 雇主时间线归属 + 后续主动发起取用 |
| `content.text` | 评论正文 | — |

> 简言之：**Agent/Owner 的每一次需要雇主看到的发言，都要经 `employer-mentions` 推一次**，无论它是新开话题、回复雇主、还是回复雇主主动开的顶层 Comment。

### 4.3 Agent / Agent Owner 主动 @employer（路径 3）

即 §13.2 的原始场景，取值同 §4.2，区别只是评论本身是新开的、而非回复某条已有评论。M 侧不区分，统一落为一条 `pending` 提问。

### 4.4 `pending` 语义提示（可选改进）

M 侧目前把所有入站 mention 一律记为 `pending`，雇主侧统一显示「N 条待你回复」徽标。因此 **Agent/Owner 的纯告知性回复也会显示「待你回复」**。

若你侧希望区分「需雇主回复」与「纯通知」，请告知（例如加 `needs_reply: boolean`），M 侧可加字段并在 UI 上分流。

---

## 5. 幂等：双向都请严格去重

### 5.1 M→C（雇主发起）

M 侧 outbox 是 **at-least-once + 退避 + 5 次失败进死信**。且 `webhook_outbox.event_id` **没有唯一约束**，同一 `event_id` 出现多行、重复投递是**真实现象**。

- 主动发起的 `event_id` **显式取「出站消息行 id」**（= `data.message_id`），不是随机生成 → 死信重放（DLQ replay）会复用同一 `event_id`。
- 因此：**同一 `event_id` 重复投递只能产生一条 Comment**（与 §13.3 现有要求一致）。
- 建议以 `event_id` 建唯一约束，`ON CONFLICT DO NOTHING` 后返回既有 `comment_id`。

### 5.2 C→M（Agent / Agent Owner 发起）

- 以 `mention_id` 去重（M 侧已实现，见 §3.3）。
- 重试请换新的 `X-Request-Id`（防重放 nonce，见 §3.1），但**保持同一 `mention_id`**，这样重复投递只会落一行。

---

## 6. 需要 C 侧处理的两件事

### 6.1 `addressees` 只有类型、没有人：请按 `workspace_id` 反查

M 侧**无法**知道 Console 侧 Agent / Agent Owner 的具体 uuid（那是 Console 的 Project 成员数据，Console 才是真相源）。因此 `addressees` 只传语义提示 `[{"type":"agent_owner"}]`，含义是「本订单中标工作室的负责人」。

请据 `workspace_id`（对应 Console 的 workspace）解析出实际收件人并写入 `mentioned_members` / 触发 Inbox 通知与 Agent 唤醒。

> 若你侧希望改用别的方式定位收件人（例如直接定位该 Project Task 的 assignee），也请一并说明，M 侧可调整字段。

### 6.2 Agent/Owner 对「雇主顶层 Comment」的回复必须回推

见 §4.2。这是本版新增的必做项，也是三个发起方能否闭环的关键。

---

## 7. M 侧已做的前置校验（不会给你送废包）

以下情况 M 侧直接返回结构化错误，**不会**入 outbox、不会产生死信：

| 场景 | M 侧响应 |
|---|---|
| `text` 为空 / 超过 4000 字 | `400 VALIDATION_INVALID_PAYLOAD` |
| `client_message_id` 非 uuid | `400 VALIDATION_INVALID_PAYLOAD` |
| 订单尚无 `project_id`（Console 还没建 Project） | `422 STATE_INVALID_TRANSITION` |
| **订单尚无 Console `task_id`**（Console 还没推过任何入站提问） | `422 STATE_INVALID_TRANSITION` |
| 订单已取消 | `422 STATE_INVALID_TRANSITION` |

> 第 3 条是对历史问题的针对性拦截：此前 `spec_change.*` 因缺 `project_id` 被 Console 返 400 并打进死信队列。
> 第 4 条是 2026-09-25 联调新增：Console 顶层 Comment 分支要求 `task_id`，缺它必然 400，故 M 侧前置拦下。
> 含义：**Agent 必须先提问过一次**，雇主才能主动开新线程；在此之前前端会看到 422 提示（`employer_outbound_messages` 不会留行）。
> 该 `task_id` 取自**最近一条入站提问**的 `project_task_id` —— 这也是 §3.2 建议你侧每次都带 `project_task_id` 的原因。

---

## 8. 响应要求

### 8.1 C→M（`employer-mentions`）

按 §3.4 返回 `201` + `{ok, mention_id, received_at, duplicate}` 即可（M 侧已实现，此处仅作对照）。

### 8.2 M→C（`employer-reply`）

**对合法 payload 必须返回 2xx**（200 即可，响应体沿用现有格式）：

```json
{ "received": true, "comment_id": "<uuid>" }
```

`comment_id` 建议回写（可选，M 侧暂不强制）。若你侧愿意在响应里带上，M 侧后续可用于把出站消息状态从 `queued` 推进为 `delivered`。

**注意**：返回 4xx 会让该事件直接进死信；返回空 200 会触发你侧 reconcile 告警（此前已出现过）——请返回上述结构化响应。

---

## 9. 雇主侧在平台看到的形态（供你侧对照，无需实现）

CSI 订单详情页新增「沟通」区块（`EmployerOrderDetail.tsx` + `EmployerOrderChat.tsx`），时间线合并三类内容、按时间升序：

1. **入站提问 / 回复**（Console 经 `employer-mentions` 推来，`pending` 标「待你回复」）—— 展示名取 `from.display_name`，缺省按 `from.type` 显示「Agent」或「Agent Owner」
2. 雇主回复（写回原提问评论下，threading）
3. 雇主主动发起（本文档第 2 节）

雇主侧读取 `GET /api/v1/longtask/employer/orders/{id}/messages`，均为平台内部接口，C 侧无需调用。

---

## 10. 联调验收

### 10.1 M→C（雇主发起）

1. **主动发起**：雇主在 CSI 页面发送一条 → M 侧 `employer_outbound_messages` 新增一行；Console 侧该 Project Task 下新增一条**顶层** Comment（`source='employer_reply'`，无 `in_reply_to_comment_id`）。
2. **幂等**：对同一 `event_id` 重放 → 只存在一条 Comment。
3. **收件人**：`mentioned_members` 非空，对应工作室负责人收到 Inbox 通知。
4. **无 project_task_id 场景**：用一条尚无 Agent 提问的订单发起 → M 侧 422 前置拦截（不投递、不留行），你侧不会收到该事件。

### 10.2 C→M（Agent / Agent Owner 发起）

5. **首次推送**：推一条 `employer-mentions` → M 侧 `employer_mentions` 新增一行 `pending`；CSI 雇主页面出现该提问，展示名为「Agent」或「Agent Owner」。
6. **幂等**：同一 `mention_id` 再推一次 → 返回 `duplicate=true`，库内仍 1 行，雇主侧不重复显示。
7. **回流闭环**：雇主回复该提问 → Console 原评论线程下新增回复（`in_reply_to_comment_id` 指向原评论）。
8. **顶层 Comment 回流（§4.2）**：雇主主动开新话题 → Agent/Owner 在该 Comment 下回复 → **必须**回推 `employer-mentions` → CSI 雇主页面能看到该回复。
9. **重试**：同 `mention_id` + 新 `X-Request-Id` 重发 → 不产生重复行、不报 401。
10. **非签约阶段拦截**：对一条 `contract_status=signed` 的订单推送新 `mention_id` → 返回 `422 STATE_PROJECT_NOT_SPEC_SIGNING`，M 侧不留行；而对该订单**已受理过**的 `mention_id` 重发 → 仍 `duplicate=true`（不 422）。
11. **同键改正文**：同 `mention_id`、`content.text` 改为不同文本 → 返回 `409 VALIDATION_IDEMPOTENCY_CONFLICT`，M 侧不留行、不通知；仅 `sent_at` / `attachments` 变化时仍返回 `duplicate=true`（不得误判）。

```sql
-- Console 侧（库 multica_beta）：确认评论与线程化
SELECT id, source, issue_id, in_reply_to_comment_id, created_at
FROM comment
WHERE issue_id = '<project_task_id>' ORDER BY created_at DESC LIMIT 10;
-- 顶层 Comment：in_reply_to_comment_id IS NULL
-- 雇主回复：in_reply_to_comment_id = Agent 评论 id
```

```sql
-- M 侧（库 genesis_db）：入站提问
SELECT id, mention_id, status, from_type, from_display_name, created_at
FROM employer_mentions WHERE order_id = '<order_id>' ORDER BY created_at DESC;

-- M 侧：出站消息与投递状态
SELECT id, order_id, project_id, project_task_id, status, created_at
FROM employer_outbound_messages WHERE order_id = '<order_id>' ORDER BY created_at DESC;

SELECT event_id, event_type, status, attempts, last_error
FROM webhook_outbox WHERE event_id = '<message_id>';
-- status 应为 success（非 dead）
```

---

## 11. 参考

- 契约：`csi-longtask business-docs/design/employer-integration-api.md` §13.1（Comment 唯一真相源）/ §13.2（推送 Mention，注意 §3.5 的实测差异）/ §13.3（雇主回复）
- M 侧实现：
  - 入站：`backend/src/longtask/contract/marketplace-contract.controller.ts`（`POST orders/:id/employer-mentions`）、`contract/hmac.guard.ts`
  - 服务：`backend/src/longtask/marketplace-orders/spec-contract.service.ts`（`receiveEmployerMention` / `listEmployerThread` / `sendEmployerMessage` / `enqueueEmployerReply`）
  - 实体：`employer-mention.entity.ts`（入站）、`employer-outbound-message.entity.ts`（出站）
  - 雇主接口：`marketplace-orders/employer-marketplace-orders.controller.ts`
- 关联文档：《C 侧修改需求-澄清等待回路与雇主Mention回传.md》（第 7 节待办清单）
