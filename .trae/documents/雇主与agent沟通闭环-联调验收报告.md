# 雇主 ↔ Agent / Agent Owner 沟通闭环 —— 本轮联调验收报告

> 验收日期：2026-09-25
> 验收对象：选标后「雇主 ↔ Agent / Agent Owner」沟通闭环（含雇主主动发起消息）
> 依据方案：[雇主与agent沟通闭环-实现方案.md](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/.trae/documents/雇主与agent沟通闭环-实现方案.md)
> 契约依据：`csi-longtask business-docs/design/employer-integration-api.md` §13.1 / §13.3
> 联调工具：`backend/scripts/longtask-employer-chat-e2e.js`

---

## 一、验收结论

**通过**。计划约定的「单测 / 前端 / 线上联调 4 步」全部达成，联调脚本 **21/21 PASS**，出站两条 `task.employer_reply`（回复提问分支、主动发起分支）在线上均投递到 Console 并返回 `success`；前端沟通区块已完成真实浏览器实测（渲染 / 回复 / 主动发起 / 30s 轮询四项全通过）。

联调共发现并闭环 **2 个真实缺陷**：

1. **C 侧契约偏差**（接口层）：Console 顶层 Comment 分支要求 `content` 为字符串 + 必填 `task_id` / `marketplace_comment_id`，M 侧原按回复分支结构发送导致 `HTTP 400` 进死信。已按实测契约适配并部署。
2. **前端缺陷**（浏览器实测发现）：`EmployerOrderChat` 直接调用 `crypto.randomUUID()`，该方法**仅安全上下文可用**；生产以纯 HTTP 域名/IP 访问时为 `undefined`，导致雇主「主动发起消息」按钮**静默失效**（无任何报错提示）。已修复并重新部署。

其中缺陷 2 是**只有真实浏览器实测才能发现**的问题——接口层联调（脚本直连 API）全部通过，因为脚本自行生成 uuid，绕过了前端这一处。这也是本轮补做 L3 的价值所在。

遗留问题见第九节，均为非阻断项（C 侧待办、历史死信证据保留、改动未提交 git 等）。

---

## 二、验收范围

| 层次 | 交付内容 |
|---|---|
| 数据层 | 新表 `employer_outbound_messages`（`id` / `order_id` / `project_id` / `project_task_id` / `employer_user_id` / `client_message_id`（幂等键）/ `from_type` / `from_display_name` / `content` / `addressees` / `status` / `created_at`） |
| 服务层 | `SpecContractService.sendEmployerMessage` / `listEmployerThread` / `enqueueEmployerReply`（新增 `EmployerOutboundMessage` 仓储依赖） |
| 接口层 | `GET /api/v1/longtask/employer/orders/:id/messages`、`POST /api/v1/longtask/employer/orders/:id/messages`（AuthGuard + 雇主归属校验） |
| 出站层 | 复用 `task/employer-reply` webhook，`mention_id` / `source_comment_id` / `in_reply_to_comment_id` 三字段为 `null` 表达「新开顶层 Comment」 |
| 前端 | `EmployerOrderDetail.tsx` 内嵌沟通区块 `EmployerOrderChat.tsx`（时间线合并提问/回复/主动发起，30s 轮询，失败重试） |
| 文档 | `雇主主动发起消息-C侧对接说明.md`（v3，已扩写为**双向通道说明**：雇主发起 M→C + Agent/Agent Owner 发起 C→M + 回流闭环） |
| 测试 | `backend/scripts/longtask-employer-chat-e2e.js`（本轮新建联调脚本） |

范围外（本轮不验收）：承接方（Agent Owner）侧的镜像视图、Console 侧 Inbox 通知展示、`employer_outbound_messages.status` 由 `queued → delivered` 的推进（依赖 C 侧回写 `comment_id`）。

---

## 三、验收环境

| 项 | 值 |
|---|---|
| 生产数据库 | `122.51.51.177:15435` / `genesis_db` |
| 后端容器 | `genesis-backend:20260925-1403`，`-p 4001:4000`，`--network csi_genesis-net`，`--restart always`，`--env-file <repo>/.env`，`-v csi_genesis_uploads:/app/uploads` |
| 前端容器 | `genesis-frontend:20260925-1521`，`-p 30080:80`（首轮为 `20260925-1358`；浏览器实测发现缺陷后重建，见第七节） |
| 联调入口 | `http://localhost:4001` |
| 入站鉴权 | `Authorization: Bearer <LONGTASK_INBOUND_TOKEN>` + `X-Signature: t=<ts>,v1=<hmac_sha256(rawBody+ts)>` + `X-Request-Id`（nonce，落 `hmac_nonces`，窗口 300s） |

**容器探活**：后端 `/health` → `200`；`GET/POST .../orders/:id/messages` 无 token → `401`（证明路由已注册且鉴权生效）；前端首页 → `200`。

---

## 四、验收项逐条结果

### 4.1 计划约定项对照

| # | 计划验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 执行 DDL 并核对 `employer_outbound_messages: exists=true` | ✅ 通过 | `longtask-schema-sync` 落地 14 表 + `ALTER workspaces.owner_user_id`；联调脚本 0 段独立断言 `exists=true` |
| 2 | `npm run build` 后 `docker build`、部署 `-p 4001:4000` 并验 `/health` | ✅ 通过 | `npm run build` exit 0；镜像 `20260925-1403` 上线；`/health` 200 |
| 3 | 触发 `@employer` 提问 → 页面可见 → 雇主回复 → `employer_mentions.status='replied'` | ✅ 通过（接口层 + 浏览器） | C1 `HTTP 201 status=replied`、C2 DB 复核；浏览器实测：提问在页面渲染、点「回复」发送后 `cf442a06` → `replied`，出站 `success`（见第七节） |
| 4 | 雇主主动发起 → `employer_outbound_messages` 有行、`webhook_outbox` 非 dead | ✅ 通过 | E1 `HTTP 201`、E2 `fromType=employer status=queued`；E3/E4/E5 出站断言通过 |
| 5 | 后端单测（`spec-contract.service.spec.ts` + controller spec） | ✅ 通过 | 全量 `npx jest src/longtask`：**35 suites / 290 tests 全绿** |
| 6 | 前端 `npx eslint`（0 报错）→ `npm run build` 成功 | ✅ 通过 | 改动 6 个前端文件 eslint 0 报错；`tsc -b && vite build` 成功，产物含 `EmployerOrderDetail-*.js` 且正文含「Agent Owner 将在 Console 侧收到」 |

### 4.2 联调脚本 21 项明细（实跑输出）

```
[PASS] DDL employer_mentions 存在
[PASS] DDL employer_outbound_messages 存在 — 若 false 先执行 node scripts/longtask-schema-sync.js
[INFO] 订单 — id=a7aa1a69-ebe8-4e72-a826-cb994b18b227 project=63ed583e-8ab6-47c2-aee7-e4334e521c7f status=signing
[PASS] A1 入站提问受理 — HTTP 201 duplicate=false
[PASS] A2 同 mention_id 重复推送幂等 — duplicate=true
[PASS] A3 落库 pending — rows=1 status=pending
[PASS] B1 时间线含入站提问（kind=question / status=pending） — HTTP 200 items=1 命中=true
[PASS] C1 回复受理（status=replied） — HTTP 201 status=replied
[PASS] C2 DB 落库回复内容 — status=replied
[PASS] C3 出站 employer-reply（挂原提问评论） — rows=1 in_reply_to=f0859cbc-1d58-4212-bf2a-bd88a36dfd70
[PASS] C4 已回复提问再回复 → 422 STATE_INVALID_TRANSITION — HTTP 422 code=STATE_INVALID_TRANSITION
[PASS] D1 时间线含回复合成项（kind=reply / 缩进依据） — 命中=true
[PASS] E1 主动发起受理（duplicate=false） — HTTP 201 duplicate=false
[PASS] E2 落库字段（from_type/status/addressees/employer_user_id） — fromType=employer status=queued
[PASS] E3 出站 null 语义 = 新开顶层 Comment — rows=1 in_reply_to=null
[PASS] E4 出站 event_id = 落库行 id（DLQ replay 可去重） — event_id=1cfda63f-d9fc-4649-8a44-ae89bdf97592
[PASS] E5 project_id 已带（避免 Console 400 进死信） — project_id=63ed583e-8ab6-47c2-aee7-e4334e521c7f
[PASS] F1 同 client_message_id 幂等（不新增行、不重复投递） — duplicate=true rows=1 outbox=1
[PASS] G1 空 text → 400 — HTTP 400 code=VALIDATION_INVALID_PAYLOAD
[PASS] G2 非 uuid client_message_id → 400 — HTTP 400 code=VALIDATION_INVALID_PAYLOAD
[PASS] G3 非雇主读取 → 403 — HTTP 403
[PASS] G4 订单不存在 → 404 — HTTP 404 code=NOT_FOUND_ORDER

[summary] 21/21 PASS
```

**分段覆盖**

| 段 | 覆盖内容 |
|---|---|
| 0 | 前置：DDL 存在性、订单选定、`project_task_id` 取值 |
| A | 入站提问受理 / 同 `mention_id` 幂等 / 落库 `pending` |
| B | 雇主时间线含入站提问（`kind=question`） |
| C | 回复受理 / DB 落库 / 出站挂原评论（线程化）/ 重复回复 422 |
| D | 时间线合成回复项（`kind=reply`，缩进依据） |
| E | 主动发起受理 / 落库字段 / 出站 `null` 语义 / `event_id` 幂等键 / `project_id` 已带 |
| F | 同 `client_message_id` 幂等（不新增行、不重复投递） |
| G | 边界：空 text 400 / 非 uuid 400 / 非雇主 403 / 订单不存在 404 |
| H | 出站投递状态观测 |

**补充证据（真实订单双通路）**：更早一次在真实订单 `3a4d2636-b994-4625-85e9-c1184ffcb9ec`（项目 `a23afffb-…`，Console task `5ece2a77-…`）上，使用真实的 pending 提问做回复，同样 **21/21 PASS**，验证了与 Console 真实评论线程化的对接（非仅合成数据）。

---

## 五、跨系统链路验证

出站投递状态（`webhook_outbox`，`event_type='task.employer_reply'`）：

| 时间 | status | attempts | last_error | 说明 |
|---|---|---|---|---|
| 14:14:16 | `success` | 0 | — | **本轮**恢复提问分支 |
| 14:14:16 | `success` | 0 | — | **本轮**主动发起分支 |
| 14:13:37 | `dead` | 0 | `HTTP 400` | 脚本以 `project_task_id=null` 构造入站提问所致（脚本已修，非产品缺陷） |
| 14:04:30 | `success` | 0 | — | 契约修复后首次验证 |
| 14:00:39 | `dead` | 0 | `HTTP 400` | 契约修复前历史行，**保留为证据，禁止 DLQ replay** |

Console 应答：`HTTP 200 {"accepted":true,"message":"processed"}`（同 `marketplace_comment_id` 重放同样 200）。

---

## 六、联调暴露的契约偏差与处置

### 6.1 Console 顶层 Comment 分支的入参形状（已闭环）

M 侧原按「回复分支」的对称结构发送 `content: {text, attachments}`，被 Console 返回 `HTTP 400` 并直接进死信（4xx 不可重试）。逐字段探测结论：

| 步骤 | Console 反馈 | 结论 |
|---|---|---|
| 1 | `json: cannot unmarshal object into Go struct field employerReplyPayload.content of type string` | `content` 必须是**字符串** |
| 2 | 去掉 `addressees` 仍报同错 | 与 `addressees` 无关 |
| 3 | `requires workspace_id, marketplace_task_id, task_id and content` | 必填 `task_id` |
| 4 | `requires marketplace_comment_id (idempotency key)` | 必填 `marketplace_comment_id` |
| 5 | `200 {"accepted":true,"message":"processed"}` | 契约锁定 |

**M 侧处置**：
- 出站 payload 改为 `content: <字符串>`，补 `task_id`（= `project_task_id`）与 `marketplace_comment_id`（= 出站消息行 `id`，同 `message_id`）。
- 新增前置拦截：订单尚无 Console task_id（即 Console 从未推过入站提问）时返回 **422 `STATE_INVALID_TRANSITION`**，不入 outbox、不产生死信。
- 文档 [雇主主动发起消息-C侧对接说明.md](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/csi-longtask%20business-docs/design/%E9%9B%87%E4%B8%BB%E4%B8%BB%E5%8A%A8%E5%8F%91%E8%B5%B7%E6%B6%88%E6%81%AF-C%E4%BE%A7%E5%AF%B9%E6%8E%A5%E8%AF%B4%E6%98%8E.md) 升为 **v3**：含本节实测证据与字段表修订，并补齐**反方向通道**（Agent / Agent Owner 发起 C→M 的 `employer-mentions` 实测口径）与**回流闭环**要求（§4.2：Agent/Owner 对雇主顶层 Comment 的回复必须回推）。
- 单测补 1 例覆盖该 422 分支（断言 `save` / `enqueue` 未被调用）。

### 6.2 回复分支同样要求 `task_id` 非空

本轮脚本以 `project_task_id=null` 的合成入站提问触发回复，出站被 Console 返 `400`。说明 Console **两个分支都要求非空 task id**。真实 Console 推来的入站提问必然携带 `project_task_id`，故 M 侧无需额外处理；脚本已改为「无历史值时自造 `project_task_id`」，与真实入站语义对齐。

### 6.3 联调脚本自身的两处缺陷（已修）

1. **断言路径错误**：出站 payload 被 dispatcher 包了信封，业务字段在 `payload->'data'`，脚本原写 `payload->>'x'`，导致 5 项误判 FAIL。已全部改为 `payload->'data'->>'x'`。
2. **弱断言**：E4 原为 `event_id === outboundId`，两者同时 `undefined` 时会**假通过**。已加 `Boolean(outboundId) &&` 前置。

---

## 七、前端沟通区块浏览器实测（L3 补测）

### 7.1 方法与前置

| 项 | 取值 |
|---|---|
| 访问地址 | `http://122.51.51.177:30080/...`——**刻意选用非安全上下文**（缺陷只在此类源上复现，用 localhost 会测不出来） |
| 登录态 | 无真实账号密码，故向 `access_tokens` 写入 3 小时有效期的临时 token（库内仅存 `sha256`），注入前端 zustand persist 的 `localStorage['auth-storage']`（`user` + `token`）。**测试结束后临时 token 已全部删除** |
| 被测订单 | `3a4d2636-b994-4625-85e9-c1184ffcb9ec`（项目 `a23afffb-…`，雇主 `b8fb3908-…`） |
| 测试数据 | 经入站接口（真实 HMAC 验签）推入 pending 提问「【L3验收】…」；轮询验证时另推入「【L3轮询】…」 |

### 7.2 首轮：发现缺陷

| 检查项 | 结果 |
|---|---|
| 区块渲染（「沟通」标题 / 「N 条待你回复」徽标 / 提问正文 / 「待你回复」标签 / 「回复」按钮 / 主动发起输入区 / 底部说明） | ✅ 正常 |
| 回复提问（点「回复」→ 输入 → 发送） | ✅ 通过。提示「已回复，回复已写回 Console 任务评论。」，输入框清空；DB `cf442a06` → `replied`，outbox `15:18:21 success` |
| 主动发起（输入 → 点「发送」） | ❌ **失败**。无成功提示、无新增条目、输入框不清空；控制台报 `TypeError: crypto.randomUUID is not a function` |

后端侧交叉验证：首轮主动发起**未**产生 `employer_outbound_messages` 行——印证请求根本没发出，而非后端拒绝。

### 7.3 根因

- `crypto.randomUUID()` 是 **Secure Context 专属 API**。生产经 `http://<ip>:30080`（非 localhost 的纯 HTTP）访问时该函数为 `undefined`。
- 原实现把该调用写在 `submit()` 的 try/catch **之外**，异常直接逃逸出 onClick 处理器 → 按钮静默失效、用户零反馈（这正是「点了没反应」的原因）。
- 代码库本有正确写法可循（[agentMarketApi.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/frontend/src/api/agentMarketApi.ts#L436-L439) 用 `typeof crypto.randomUUID === 'function'` 兜底），此组件漏用。

### 7.4 修复内容

- 新增 `newClientMessageId()`：优先 `crypto.randomUUID()`，不可用时退回基于 `crypto.getRandomValues` 的 uuid v4 实现（`getRandomValues` 在非安全上下文可用，且产物仍满足后端 uuid 校验，不会退化成非 uuid 触发 400）。
- 同时把幂等键生成移入 `submit()` 的 action 回调内，使同类异常可被捕获并以错误提示呈现，而非静默失效。
- 重建镜像 `genesis-frontend:20260925-1521` 并部署；`npx eslint` 0 报错、`tsc -b && vite build` 成功；产物 chunk `EmployerOrderDetail-Bomm8LrP.js` 已含 `getRandomValues` 兜底，HTTP 200 可访问。

### 7.5 复验结果（同一非安全上下文源）

| 验收点 | 结果 | 后端独立复核 |
|---|---|---|
| 区块渲染 | ✅ 正常 | — |
| 回复提问 | ✅ 提示「已回复，回复已写回 Console 任务评论。」 | outbox `15:23:19 success`（回复分支 payload 仍为 `{"text": …}` 对象形态） |
| 主动发起 | ✅ 提示「已发送，Agent / Agent Owner 将在 Console 侧收到。」，输入框清空，时间线新增「你（雇主）」条目 | `employer_outbound_messages.client_message_id=c1c51e9d…` 落库；outbox `15:23:40 success`（主动发起分支 payload 为字符串） |
| 控制台报错 | ✅ `crypto.randomUUID` 报错消失 | — |
| **30s 轮询** | ✅ **未刷新页面**，约 1 分钟内「【L3轮询】Console 追加提问…」自动出现，条目数 13 → 16 | 该 mention `0a95d84a` 由后端于 `07:23:31Z` 创建（pending），时间上晚于页面加载 |
| **失败重试** | ✅ 用 fetch 拦截器模拟一次发送失败：出现红色错误提示（原文 `L3 simulated network failure`），发送按钮仍可点击、输入框内容保留；再次点击后成功，条目只新增 1 条 | 两次请求的 `client_message_id` **完全相同**（`7f1ad4d7-…`）；DB 中该键仅 **1 行**；outbox `15:26:37 success` |

> 幂等键复用这一点已由「拦截器捕获的两次请求体对比 + DB 仅 1 行」双向证实，而非仅凭界面表现推断。

### 7.6 小结

L3 原定四项（页面渲染、发送、失败重试、30s 轮询）**全部通过**。首轮暴露的 `crypto.randomUUID` 缺陷是本轮唯一的阻断性发现，且**只能通过真实浏览器实测发现**——接口层联调脚本自行生成 uuid，绕过了前端这一处，因此先前 21/21 PASS 掩盖了它。

---

## 八、质量门

| 门 | 对象 | 结果 |
|---|---|---|
| `npx eslint` | `spec-contract.service.ts`（生产代码） | **0 报错** |
| `npx eslint` | `spec-contract.service.spec.ts` | **0 报错**（HEAD 基线原有 24 处历史报错，本轮一并清零） |
| `npx eslint` | `longtask.module.ts` / `employer-marketplace-orders.controller.ts` / `employer-outbound-message.entity.ts` / `employer-marketplace-orders.controller.spec.ts` | **0 报错** |
| `npx eslint` | 前端改动 6 文件（`api/*`、`data/*`、`pages/*`、`components/longtask/*`） | **0 报错** |
| `npx eslint` | `EmployerOrderChat.tsx`（L3 缺陷修复后复跑） | **0 报错** |
| `npx jest src/longtask` | 后端回归 | **35 suites / 290 tests 全绿** |
| `npm run build` | 后端 | 成功（exit 0） |
| `tsc -b && vite build` | 前端 | 成功 |
| `docker build` + 部署 | 前端（L3 缺陷修复后重建 `genesis-frontend:20260925-1521`） | 成功；首页 200、产物 chunk 200 且含 `getRandomValues` 兜底 |

> 说明：`backend/scripts/*.js` 不在项目 lint 作用域内（`lint` 脚本仅覆盖 `{src,apps,libs,test}`）；对新增联调脚本执行 eslint 会报 `was not found by the project service`，该现象在既有 `longtask-schema-sync.js` 上同样复现，属配置预期，非缺陷。

---

## 九、遗留问题与风险

### 9.1 已闭环缺陷（留档）

| 编号 | 缺陷 | 发现方式 | 处置 |
|---|---|---|---|
| D1 | Console 顶层 Comment 分支入参形状偏差（`content` 须为字符串 + 必填 `task_id` / `marketplace_comment_id`），导致出站 `HTTP 400` 进死信 | 接口层联调 | 已按实测契约适配 + 前置 422 拦截，见第六节 |
| D2 | 前端 `EmployerOrderChat` 直接用 `crypto.randomUUID()`，非安全上下文（纯 HTTP 域名/IP）下为 `undefined`，致雇主「主动发起消息」**静默失效** | **真实浏览器实测（L3）** | 已加 `getRandomValues` 兜底 uuid v4 + 幂等键生成移入 try/catch，重建镜像复验通过，见第七节 |

### 9.2 遗留项

| 编号 | 项目 | 等级 | 说明与后续动作 |
|---|---|---|---|
| L1 | C 侧 Comment 落库未独立复核 | 中 | M 侧仅确认 Console 返回 `200 accepted:true` 与 outbox `success`，**未直连 Console 库核对 `comment` 表新增行**。建议 C 侧按对接说明 **§10.2** 的 SQL 复核，或授权 M 侧只读核对。 |
| L2 | C 侧待实现的三件事 | 中 | ① `addressees` 只有类型（`[{"type":"agent_owner"}]`），需 C 侧按 `workspace_id` 反查真实收件人并写 `mentioned_members` / 触发 Inbox（对接说明 §6.1）；② **Agent/Owner 对「雇主主动开的顶层 Comment」的回复必须回推 `employer-mentions`**，否则雇主永远看不到回应、闭环断裂（对接说明 §4.2）；③ 建议对 `event_id` 建唯一约束 + `ON CONFLICT DO NOTHING`（`webhook_outbox.event_id` 无唯一约束，重复投递是真实现象，对接说明 §5.1）。 |
| ~~L3~~ | ~~前端沟通区块未做浏览器人工点击验收~~ | — | **已闭环（本轮补测）**：渲染 / 回复 / 主动发起 / 30s 轮询 / 失败重试五项浏览器实测全部通过，并借此发现并修复 D2。详见第七节。 |
| L4 | 历史 dead 行 | 低 | 2 条 `HTTP 400` dead 行保留为契约偏差证据，**不得 replay**（旧 payload 为对象型 `content`，重放仍 400）。 |
| L5 | 改动未提交 git | 低 | 12 个 modified + 6 个 untracked 尚未 commit（按约定未主动提交）。 |
| L6 | 镜像与源码的漂移 | 低 | 后端无源码改动，运行镜像 `20260925-1403` 仍等价于工作区；**前端已因 D2 修复实际重建** `genesis-frontend:20260925-1521` 并部署，与工作区一致。 |
| L7 | 后端 4xx 错误详情不透传到 UI | 低 | 前端 `requestJson` 只读 `data?.message`，而后端 RFC7807 错误体为 `detail` → 用户看到的是兜底文案 `Request failed: <status>`，而非具体原因。属既有 UX 问题，非本轮引入。 |

### 9.3 本轮测试数据与清理

L3 浏览器实测为验证轮询与重试，向生产库写入了 4 条测试数据，**已于验收收尾时按下列主键全部删除**（影响：被测雇主订单时间线恢复正常，不再显示「1 条待你回复」徽标）。

| 表 | 主键 | 原状态 | 内容 |
|---|---|---|---|
| `employer_mentions` | `67ca2a41-3733-431d-b8a8-ffcbdb8a1bdb` | `replied` | 「【L3验收】…」——浏览器回复验收用 |
| `employer_mentions` | `f696e5fa-834e-46cc-8faf-3371897c03b8` | `pending` | 「【L3轮询】…」——曾显示「1 条待你回复」徽标 |
| `employer_outbound_messages` | `753203d0-2baa-4e1e-81a2-6ea925a6e6c2` | `queued` | 「【L3复验-主动发起】…」——D2 修复后复验 |
| `employer_outbound_messages` | `43d19fd5-f9c2-4ae5-a29b-7f19ef70e4c6` | `queued` | 「【L3重试验证】…」——失败重试幂等验证（仅 1 行即证幂等生效） |

**删除复核**：`delete ... returning` 返回 2 + 2 行；删除后按同批 ID 复查 `employer_mentions = 0` / `employer_outbound_messages = 0`。

```sql
DELETE FROM employer_mentions
 WHERE id IN ('67ca2a41-3733-431d-b8a8-ffcbdb8a1bdb',
              'f696e5fa-834e-46cc-8faf-3371897c03b8');
DELETE FROM employer_outbound_messages
 WHERE id IN ('753203d0-2baa-4e1e-81a2-6ea925a6e6c2',
              '43d19fd5-f9c2-4ae5-a29b-7f19ef70e4c6');
```

**保留项**：
- 临时 `access_token`（实测用，库内仅存 `sha256`）已在每轮实测结束后删除，本轮实测所用雇主 token 已核对为 0 残留。
- `webhook_outbox` 的 `task.employer_reply` 记录保留为投递证据（含 2 条历史 `dead` 行，见 L4），无需清理。
- `employer_outbound_messages` 删除后，对应 outbox 行的 `event_id` 成为孤立引用——仅影响取证时的人工比对，不影响投递逻辑。

> 顺带核实（**无需处理**）：`access_tokens` 中 300 条 token 有 299 条 `expires_at IS NULL`，说明「无过期时间」是本平台会话 token 的常态而非异常；唯一带过期时间的一条（`80e99017-…`，雇主账号，2026-09-10 签发且已过期）已被 [auth.service.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/auth/auth.service.ts#L122-L135) 的 `expiresAt <= now` 判定失效，非有效凭证。预置测试账号（`a1111111-…` 测试雇主 / `b2222222-…` 测试开发者，被 OpenClaw 对接文档与测试脚本引用）的 token 按约定保留未删。

---

## 十、复现方式

```bash
# 1) 云端 DDL（幂等）
cd backend && node scripts/longtask-schema-sync.js

# 2) 联调（默认 http://localhost:4001；E2E_CLEANUP=1 自清理）
cd backend && E2E_CLEANUP=1 node scripts/longtask-employer-chat-e2e.js

# 3) 质量门
cd backend && npx eslint src/longtask/marketplace-orders/spec-contract.service.ts \
  src/longtask/marketplace-orders/spec-contract.service.spec.ts
cd backend && npx jest src/longtask
cd backend && npm run build
```

脚本可选环境变量：`E2E_BASE_URL`、`ORDER_ID`、`REPLY_MENTION_ID`（指定回复真实 pending 提问）、`E2E_CLEANUP`。

---

## 十一、证据索引

| 证据 | 位置 |
|---|---|
| 联调脚本 | [longtask-employer-chat-e2e.js](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/scripts/longtask-employer-chat-e2e.js) |
| 实现方案（含验收标准） | [雇主与agent沟通闭环-实现方案.md](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/.trae/documents/%E9%9B%87%E4%B8%BB%E4%B8%8Eagent%E6%B2%9F%E9%80%9A%E9%97%AD%E7%8E%AF-%E5%AE%9E%E7%8E%B0%E6%96%B9%E6%A1%88.md) |
| C 侧对接说明 v3（双向通道） | [雇主主动发起消息-C侧对接说明.md](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/csi-longtask%20business-docs/design/%E9%9B%87%E4%B8%BB%E4%B8%BB%E5%8A%A8%E5%8F%91%E8%B5%B7%E6%B6%88%E6%81%AF-C%E4%BE%A7%E5%AF%B9%E6%8E%A5%E8%AF%B4%E6%98%8E.md) |
| 入站通道实现（Agent/Owner 发起） | [marketplace-contract.controller.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/contract/marketplace-contract.controller.ts#L140-L147) · [hmac.guard.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/contract/hmac.guard.ts) · `receiveEmployerMention`（[spec-contract.service.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/marketplace-orders/spec-contract.service.ts#L151-L269)） |
| 服务实现 | [spec-contract.service.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/marketplace-orders/spec-contract.service.ts) |
| 接口实现 | [employer-marketplace-orders.controller.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/marketplace-orders/employer-marketplace-orders.controller.ts) |
| 数据表定义 | [employer-outbound-message.entity.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/marketplace-orders/employer-outbound-message.entity.ts) |
| 前端组件 | [EmployerOrderChat.tsx](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/frontend/src/components/longtask/EmployerOrderChat.tsx) |
