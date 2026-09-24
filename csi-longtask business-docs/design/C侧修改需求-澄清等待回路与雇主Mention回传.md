# C 侧修改需求：澄清等待回路（await-input）与雇主 Mention 回传

> 提出方：M 侧（genesis-backend / Marketplace）
> 面向：Console（csi-beta-server，multica fork）开发同事
> 依据：`employer-integration-api.md` §13.1–§13.3、§3.1（HMAC 契约）
> 触发问题：任务 `BETA-206 M1 需求确认与范围基线` 卡在「第 1 轮澄清·等待 Employer」，`[@Employer][mention://employer/all]` 原样渲染，UI 提示「正在等待 Employer 回答」，且有「以 owner 身份回答 / 重试任务」按钮。
> 结论：**这不是展示层问题，而是 Console 侧澄清等待回路（await-input）与 employer mention 派发链路未实现/未闭环**：状态列不落库、run 未真正挂起、mention 收件人无法解析、期限口径前后矛盾，且雇主提问从未投递到 Marketplace。M 侧本轮已把接收端补齐（见第 6 节），C 侧需按下文 1–5 项修改。

---

## 1. 现场证据（2026-09-23，UTC）

| 对象 | 值 |
|---|---|
| workspace | `1c5c30eb-8dbd-4761-9806-186484ac813e`（gery） |
| project | `86719f1e-812f-44fa-824c-b6c43fd996e4`（收口复测B3） |
| issue / task | `8a23d024-55ad-44a1-b419-f149ec358b62`（`task_type=spec_generation`，`work_item_kind=task`） |
| run | `f688b633-030c-4b4a-8df9-302af0e7a4ce` |
| marketplace order | `795c117a-7095-4740-bbd6-7195098ea1ee`（`signed`） |
| agent 提问评论 | `0aae46a6-e3e2-4c94-b8f0-66b9bfd7c74d`（正文含 `[@Employer](mention://employer/all)`） |
| 成员答复评论 | `29955492-74ee-43d2-85fa-d2c229be95ea`（回复者 `30d60d59-5979-4ccb-af6d-e552502a1dd0`） |

时间线：

```
08:31:26  run f688b633 启动
08:47:10  建 task_interactions（kind=ask_user_questions，
          payload.addressees=[{"type":"employer"}]，deadline_at = 12:47:10Z ≈ 请求时刻 + 4h）
08:48:05  agent 发评论 0aae46a6…（正文含 mention://employer/all）
08:59:18  成员 30d60d59… 发评论 29955492… 逐条答复
          → 该评论被记为 await_input_resume_comment_id
09:09:54  前端 GET /api/workspaces/{ws}/tasks/8a23d024…/await-input → 404
09:16:00  同 404（其他 issue 复现）
09:16:17  同 404（其他 issue 复现）
09:19:30  daemon 上报 usage（input 887,266 / output 31,858）
09:19:31  CSI task run failed
```

关键查询结果：

```sql
-- ① 全库 await_input_round > 0 的队列行只有 4 行（2026-09-24 复核），且三列全空
SELECT await_input_round, await_input_requested_at, await_input_deadline_at,
       await_input_message, await_input_resume_comment_id
FROM agent_task_queue WHERE await_input_round > 0;
-- → await_input_requested_at / await_input_deadline_at / await_input_message 全部为 NULL
--    （注意：同一批行的 await_input_addressees 已有值 [{"type":"employer"}]，说明写入侧「知道」收件人但漏写时限三列）

-- ② 评论的 mention 解析结果为空（注意：评论表名是 comment，不是 task_comments）
SELECT mentioned_members, structured_markers FROM comment
WHERE id = '0aae46a6-e3e2-4c94-b8f0-66b9bfd7c74d';
-- → mentioned_members = '{}'（text[]，无人被通知）；structured_markers = '{}'（jsonb）

-- ③ project 表没有 employer 归属列（只有提醒字段）
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'project' AND column_name ILIKE '%employer%';
-- → 仅 employer_reminder_days_sent
```

> **表名/列名对照（Console 库 `multica_beta`，2026-09-24 实测）**：评论表是 `comment`（无 `task_comments`）；`agent_task_queue` 关联任务的列是 **`issue_id`**（无 `task_id` 列）；`task_interactions` 无 `addressees` 列，收件人在 `payload->'addressees'`。下文 SQL 已按此校正，可直接复制执行。

---

## 2. 缺陷 1：`await_input_*` 状态列从未写入 → `GET /await-input` 恒 404

**现象**：`GET /api/workspaces/{ws}/tasks/{task}/await-input` 一律 404（09:09:54、09:16:00、09:16:17 多个 issue 复现）。前端拿不到结构化状态，降级成「等待 Employer 回答」的静态卡片，`mention` 标记原样渲染，只能给出「以 owner 身份回答 / 重试任务」这种兜底按钮。

**根因**：创建 `task_interactions`（`kind=ask_user_questions`）时，**没有同步写 `agent_task_queue` 的 `await_input_round / await_input_requested_at / await_input_deadline_at / await_input_message`**。而 Console 二进制内所有 await-input 相关扫描器（超时置 `await_input_timeout`、到期提醒、addressee 升级为 `[{"type":"owner"}]`、resume 扫描）都以 `await_input_requested_at IS NOT NULL` 为前置条件 —— 于是整条澄清回路都空转。

**要求**：
1. 在创建 interaction 的**同一个事务**内写队列列：
   - `await_input_round = await_input_round + 1`
   - `await_input_requested_at = now()`
   - `await_input_deadline_at = now() + <统一后的等待窗口>`（见第 5 节）
   - `await_input_message = <提问正文/摘要>`
2. 上述列的写入与 interaction 行必须原子（回滚一起回滚），否则又会出现「有 interaction 无状态」的半截数据。
3. `GET /await-input` 需覆盖：`round`、`requested_at`、`deadline_at`、`message`、`addressees`、`status`、`resume_comment_id`。前端据此渲染结构化卡片（当前 404 分支可保留，但不应再被命中）。

**验收**：

```sql
-- 提问后立刻查：三列必须非空，round 自增
-- 注意：队列表关联任务的列是 issue_id（即 Console 的 task id），本表无 task_id 列
SELECT issue_id, await_input_round, await_input_requested_at,
       await_input_deadline_at, await_input_message
FROM agent_task_queue WHERE issue_id = '<task_id>';
```

```
GET /api/workspaces/{ws}/tasks/{task}/await-input  → 200（不再 404）
```

---

## 3. 缺陷 2：run 未真正挂起（澄清期间 CLI 仍在跑并最终超时）

**现象**：daemon 每 5s 轮询 `/api/daemon/tasks/f688b633-030c-4b4a-8df9-302af0e7a4ce/status` 一直持续到 09:19:30，最终失败信息为：

```
cli execution failed: codex backend: codex timed out after 0s
```

成员在 08:59:18 已答复，但 `await_input_resume_comment_id` 被写入后**没有触发 resume**（`resume_claimed_at` 为空，没有产生新的 run）。

**根因**：`ask_user_questions` 且 addressee 为 `employer` 时，任务未被置为「等待输入」的暂停态，daemon 侧也没有把 CLI 进程 park 住，于是 run 继续执行直至超时。

**要求**：
1. 只要 interaction 含非 agent 的 addressee（`employer` / `owner`），任务必须进入 `waiting_input` 态，daemon 停止推进 CLI（不是「继续跑但显示等待」）。
2. run 不应因等待被计入执行超时（`codex timed out after 0s` 属于状态未挂起导致的误判）。
3. 写入 `await_input_resume_comment_id` 后，须由 resume 扫描器**认领**（置 `resume_claimed_at`）并发起新 run，把该评论注入 Task 上下文后继续。

**验收**：成员答复后 ≤ 一个轮询周期内出现新 run，且旧 run 不因「等待」而报超时失败。

---

## 4. 缺陷 3：`mention://employer/all` 无解析映射，提问从未派发

**现象**：评论正文里的 `[@Employer](mention://employer/all)` 既没有解析成收件人（`mentioned_members={}`、`structured_markers={}`），也没有触发任何投递；`task_interactions.addressees=[{"type":"employer"}]` 也没有对应的投递动作。

**根因**：
- mention token `mention://employer/all` 在评论落库时没有匹配到任何解析规则（没有「雇主」这类跨系统身份 → 收件人 的映射）；
- `project` 表没有 employer 归属列，Console 无法把「雇主」这一抽象 addressee 落地为具体的人；
- 因此 §13.2 的 `POST /v1/marketplace/orders/{order_id}/employer-mentions` **从未被调用**（M 侧 `docker logs genesis-backend` 中该路由只有 RouterExplorer 启动映射，无任何实际请求；M 侧 `employer_mentions` 表此前为空）。

**要求**：
1. 评论落库时解析 `mention://employer/all`（以及 `mention://employer/{id}` 形态，如有）→ 得到「本项目雇主」；若项目上确实没有显式 employer 归属，需补一列/一张成员表来承载（当前 `project` 表无此列，这是必须先补的前置）。
2. 解析结果写入 `mentioned_members`（供 Inbox 通知），并按 §13.2 调 M 侧：

```
POST {MARKETPLACE_BASE}/v1/marketplace/orders/{order_id}/employer-mentions
Authorization: Bearer <c2m token>
X-Signature: t=<unix_ts>,v1=<hex hmac_sha256(body原文 + ts, 同一 c2m token)>
X-Request-Id: <nonce，窗口内唯一>
Content-Type: application/json
```

```json
{
  "mention_id": "<uuid-v7，必须合法 uuid>",
  "project_task_id": "<uuid>",
  "project_id": "<uuid>",
  "source_comment_id": "<uuid，即 agent 提问评论 id>",
  "from": { "type": "agent", "id": "<uuid>", "display_name": "Dev Agent" },
  "content": { "text": "<提问正文>", "attachments": [] },
  "related_spec_id": null,
  "related_spec_version": 1,
  "reply_endpoint_hint": "https://csi-beta-api.../v1/webhooks/task/employer-reply",
  "sent_at": "<ISO8601>"
}
```

期望响应 `201 {"ok":true,"mention_id":"…","received_at":"…","duplicate":false}`（重复推送同一 `mention_id` 返回 `duplicate:true`）。

3. 注意：`order_id` 必须是该 project 对应的 marketplace order。Console 需能由 `project_id` 反查 order（M 侧 `GET /v1/marketplace/orders/{id}/status`、`GET /v1/marketplace/workspaces/{wid}/orders` 可用于反查）。

**契约约束（M 侧已强校验，务必对齐）**：`mention_id`、`project_id`、`project_task_id`、`source_comment_id`、`from.id`、`related_spec_id` 若传入，**必须是合法 uuid 格式**；否则 M 侧返回 `400 VALIDATION_INVALID_PAYLOAD`（非法值不再触发 500）。

**验收**：提问评论发出后，M 侧 `employer_mentions` 表出现一行；`mentioned_members` 非空。

---

## 5. 缺陷 4：等待期限口径不一致（4h vs 24h）

**现象**：`task_interactions.deadline_at` 记为「请求时刻 + 4h」（12:47:10Z），而 agent 文案与 UI 显示「24h」（09-24 16:48:05 CST）。

**要求**：四处口径统一为同一个值（建议 24h，与现有文案一致），并确保同一时刻取自同一字段：
1. `task_interactions.deadline_at`
2. `agent_task_queue.await_input_deadline_at`
3. agent 写入评论的文案（「请在 N 小时内回复」）
4. 前端卡片倒计时

**验收**：任取一次澄清，上述四处时间一致。

---

## 6. M 侧本轮已完成的配套改动（C 侧可直接对接）

M 侧 `genesis-backend` 已重新构建部署（本需求上线镜像 `genesis-backend:20260923-1815`；当前线上为 `genesis-backend:20260924-131500`，端口映射 `-p 4001:4000` 不变）：

### 6.1 接收端：`POST /v1/marketplace/orders/{order_id}/employer-mentions`（§13.2）

原为空实现（只校验订单存在就返回，mention 被静默丢弃），现已补齐：

- 按 `mention_id` 幂等落库到新表 `employer_mentions`（唯一约束），重复推送返回 `duplicate:true`，不重复通知；
- 雇主可在订单详情看到提问（站内收件箱为主通道）；
- best-effort 通知雇主：微信模板未配置 / 用户未绑 openid 时落 `notification_outbox` 审计（`skipped`），**不影响 Console 推送结果**；
- 入参校验：缺 `content.text`、`mention_id` 非法 uuid 等 → `400 VALIDATION_INVALID_PAYLOAD`；订单不存在 → `404 NOT_FOUND_ORDER`。

### 6.2 新增雇主侧 API（平台内部，C 侧无需调用）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/longtask/employer/orders/{order_id}/mentions` | 本订单 Mention 收件箱（新→旧），AuthGuard + 雇主本人校验 |
| POST | `/api/v1/longtask/employer/orders/{order_id}/mentions/{mention_id}/replies` | 雇主回复；body `{text, attachments[]}`；已回复过 → `422 STATE_INVALID_TRANSITION`；mention 不存在 → `404 NOT_FOUND_MENTION` |

### 6.3 出站 webhook：`POST /v1/webhooks/task/employer-reply`（§13.3）

雇主回复后 M 侧投递的信封（实测样本，`data` 字段与文档逐字一致）：

```json
{
  "event_id": "01b5d62c-6c3f-4027-8539-414d42c967ef",
  "event_type": "task.employer_reply",
  "event_version": 1,
  "occurred_at": "2026-09-23T09:49:05.849Z",
  "sent_at": "2026-09-23T09:49:05.849Z",
  "source": "marketplace",
  "data": {
    "mention_id": "43a564db-bfbe-43d3-ae07-e8fec56f1848",
    "source_comment_id": "0aae46a6-e3e2-4c94-b8f0-66b9bfd7c74d",
    "project_task_id": "e1a0b6c2-1111-4222-8333-444455556666",
    "project_id": "eafebb49-a6e0-4b6f-a16e-f7350ae7fcfd",
    "order_id": "564df59f-7367-4ff3-8ef2-7fccd132342e",
    "from": { "type": "employer", "id": "b8fb3908-…", "display_name": "用户24565" },
    "content": { "text": "需要支持微信和 Google 登录", "attachments": [] },
    "in_reply_to_comment_id": "0aae46a6-e3e2-4c94-b8f0-66b9bfd7c74d",
    "sent_at": "2026-09-23T09:49:05.849Z"
  }
}
```

签名口径与入站一致：`Authorization: Bearer <m2c token>` + `X-Signature: t=<ts>,v1=<hmac_sha256(body原文 + ts)>`；收到后按 §13.3 处理 —— 直接 INSERT 成 Task Comment（`source='employer_reply'`），并按 `in_reply_to_comment_id` 挂回原提问评论，同时**唤醒等待中的 Agent**（即第 3 节的 resume 路径）。

> 说明：M 侧目前只负责投递，**不重试到 Console 明确受理为止以外的语义**：outbox 采用 at-least-once + 退避 + 死信（5 次失败进死信表）。因此 Console 端 **必须按 `event_id` 幂等**（同一 event_id 重复投递只能产生一条 Comment）。

---

## 7. C 侧待办清单（按依赖顺序）

| # | 事项 | 依赖 |
|---|---|---|
| 1 | 补 `project` 的 employer 归属（列或成员表） | — |
| 2 | 解析 `mention://employer/all` → 收件人，写入 `mentioned_members` | 1 |
| 3 | 澄清发起时原子写 `agent_task_queue.await_input_*` 四列 | — |
| 4 | 含 employer/owner addressee 时任务真正挂起，run 不计入执行超时 | 3 |
| 5 | `await_input_resume_comment_id` 写入后由 resume 扫描器认领并发起新 run | 3、4 |
| 6 | 统一等待窗口口径（`task_interactions.deadline_at` / `await_input_deadline_at` / 文案 / UI） | 3 |
| 7 | 实现 `POST /v1/webhooks/task/employer-reply` 接收端（按 event_id 幂等，Comment + 唤醒） | 5 |

## 8. 联调验收脚本（建议 C 侧自测后由双方共同复跑）

1. 触发一次 Agent @employer 提问 →
   - `agent_task_queue.await_input_*` 四列非空、`await_input_round` 自增；
   - `GET …/await-input` 返回 200；
   - `task_comments.mentioned_members` 非空；
   - M 侧 `employer_mentions` 出现对应 `mention_id` 行（重复推送 `duplicate:true`）。
2. 雇主在平台回复 →
   - M 侧投递 `task.employer_reply`，Console 新增一条 `source='employer_reply'` 的 Comment；
   - 等待中的 run 被唤醒并产生新 run（旧 run 不报超时）；
   - 同一 `event_id` 重放不产生第二条 Comment。
3. 等待超时（按第 6 项统一后的窗口）→ 任务置 `await_input_timeout`，并按既有升级规则处理。

**可直接执行的核对 SQL（表名/列名已按 2026-09-24 实测校正）**：

```sql
-- Console 侧（库 multica_beta）
-- a) 澄清是否真的挂起：四列非空且 round 自增
SELECT issue_id, await_input_round, await_input_requested_at, await_input_deadline_at,
       await_input_message, await_input_addressees, await_input_resume_comment_id,
       resume_claimed_at
FROM agent_task_queue WHERE issue_id = '<task_id>' ORDER BY created_at DESC;

-- b) mention 是否解析成收件人（空数组即为未解析）
SELECT id, mentioned_members, structured_markers FROM comment
WHERE id = '<提问评论id>';

-- c) 雇主回复是否落成 Comment（source=employer_reply）且挂回原提问
SELECT id, source, issue_id, created_at FROM comment
WHERE issue_id = '<task_id>' ORDER BY created_at DESC LIMIT 10;

-- d) 等待期限口径是否统一（应等于 await_input_deadline_at）
SELECT task_id, kind, deadline_at, payload->'addressees' AS addressees
FROM task_interactions WHERE task_id = '<task_id>' ORDER BY created_at DESC;
```

```sql
-- M 侧（库 genesis_db，只读核对；<order_id> 为该 project 对应的 marketplace order）
SELECT mention_id, order_id, project_task_id, source_comment_id, status,
       (reply IS NOT NULL) AS has_reply, replied_at, created_at
FROM employer_mentions WHERE order_id = '<order_id>' ORDER BY created_at DESC;
-- 幂等：同一 mention_id 只应有一行（重复推送时接口返回 duplicate:true，不新增行）
```

---

## 9. 参考

- 契约：`csi-longtask business-docs/design/employer-integration-api.md` §13.1 / §13.2 / §13.3；鉴权 §3.1
- M 侧实现：`backend/src/longtask/marketplace-orders/spec-contract.service.ts`（`receiveEmployerMention` / `employerReplyMention` / `notifyEmployerReply`）、`backend/src/longtask/marketplace-orders/employer-mention.entity.ts`、`backend/src/longtask/contract/marketplace-contract.controller.ts`
- 联调环境：Console `csi-beta-server`（k8s ns `csi-beta`，库 `multica_beta`）；M 侧 `genesis-backend` `http://122.51.51.177:4001`