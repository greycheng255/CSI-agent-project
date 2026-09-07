**主题：密钥已回切 + 按贵方姿势重推仍 400（附对照实验实据）——请确认贵方 pull 凭证与 Sync 执行，并书面澄清 work item 缺失语义**

Agent Owner Console 团队各位好：

贵方《联调综合回复》已收悉并逐项落实。密钥回切与请求体修正均已完成，但按贵方指定姿势重推**仍然 400**，且我方拿到了一组对照实验实据，表明 400 根因与贵方文档所述仍有出入。请看下文。

---

**【第一部分】我方已完成的三项动作（均有验证记录）**

**1. c2m- 密钥已回切（单密钥口径）**

- 我方入站验签已切为贵方经联调群发送的 `c2m-4a7d...` 值：Bearer 比对与 HMAC 重算均用该单密钥，独立 HMAC 密钥变量已停用。
- **验证通过**：我方自验 W2 端点（`POST /v1/webhooks/workspace/changed`）以 c2m- 签名投递 `workspace.updated` 事件 → **201**，beta-ac4-ws 快照（含 `capability_tags: ["web"]`）已幂等落入我方投影。
- 贵方 W2 生命周期事件推送现可随时通过我方 HMAC 门。

**2. 请求体已按贵方"当作新事件投递"姿势修正**

- 重推走我方 outbox 投递链路（非手工 curl）：**完整 §9.1 契约信封 808 字节**（`event_id`/`event_type`/`event_version`/`occurred_at`/`sent_at`/`source` + `data.task_brief{title/description/category/budget_range/seat_limit/bid_round/attachments/published_at/...}`）+ **全新 event_id**，与贵方文档第二部分第 4 条要求的姿势逐字一致。

**3. 我方 pull 端点就绪且验签通过**

- 以 c2m- 签名自验 `GET /v1/marketplace/tasks?status=open` → **200**，3 个 open web 任务（含完整 task_brief 字段）均可正常返回。
- 贵方 auto-discover Sync 随时可拉。

---

**【第二部分】按贵方姿势重推仍 400——对照实验实据与两点出入**

**1. 实验过程**

- 实验 A：完整 808 字节信封 + 全新 event_id（outbox 实投，cron 10s 驱动）→ 400，`replay of event X found no persisted marketplace work item`，**X 为我方从未见过的 id**；
- 实验 B：同一请求**去掉 `Idempotency-Key` 头** → 400 同款文案，**X 恰为我方本次全新 event_id**；
- 实验 C：换另一个从未推过的 task（全新 (workspace, task) 组合）→ 400 同款，X 仍随每次请求变化。

**2. 实验结论：贵方 push 承接对每个新事件都按 event_id 查找 work item，缺失即 400**

- 实验 B 中请求体完整非空、event_id 全新，仍走"replay"分支报"found no persisted marketplace work item"——说明该分支触发条件**并非贵方文档所述的"空 body"**，而是"按 event_id（或 (workspace, task) 组合）查不到已入账工作项"；
- 即：**work item 缺失时，新事件（完整 payload）同样被 400 拒绝**，与贵方文档第二部分第 2 条声明的"开启 = 幂等投影商机（即契约 §9.1'创建商机记录'语义）→ 200 ACK"不符；
- 另注：带 `Idempotency-Key` 头时贵方报的 X 为旧 id（疑似按头查历史事件），不带头时 X 才是我方本次 id——该头在贵方侧的处理逻辑也请一并确认。

**3. 两点出入请贵方复核**

- 出入一：贵方文档称 8 次重推 payload 均为空——**此后我方唯一一次 outbox 链路实投（今日）payload 完整且仍 400**，故"补齐 payload 即可 200"的结论不成立，还有 work item 前置缺失问题；
- 出入二：贵方文档称 push 承接不依赖 pull/Sync 投影产物——但实验 B/C 表明 work item（其来源正是贵方 Sync 投影）缺失时新事件直接 400，**事实上形成了依赖**。

---

**【第三部分】请贵方确认的三件事**

**1. 贵方 pull 出站凭证是否已切 c2m-？**

我方密钥回切后（今日 11:37 起），**无任何贵方 pull 请求到达我方**。若贵方 Sync 出站仍发 `09d9ee06...` Bearer / `2c42...` HMAC（此前代理抓包所见的旧双密钥），会被我方 401 挡住，auto-discover Sync 将持续失败。请确认贵方出站已按方向密钥接线 c2m-，并触发一次 Sync。

**2. beta-ac4-ws 的 work item 是否已实际投影？**

请确认贵方 auto-discover Sync 已真实执行并将 beta-ac4-ws × 我方 3 个 open web task 的 work item 投影入账（可查贵方 `inbound_webhook_events` / work item 台账）。**贵方 Sync 一旦投影完成，我方立即重推，当场闭账。**

**3. 请书面澄清 work item 缺失时新事件的预期行为**

契约 §9.1 写的是"创建商机记录"，贵方文档第二部分声明"幂等投影商机 → 200"，实测却是 400 拒绝——三者需对齐：
- 若按实测行为（400）走：请回写契约 §9.1，我方后续 push 前需等贵方 Sync 先投影（即接受 push 对 pull 的前置依赖）；
- 若按契约/文档语义（创建/投影 → 200）走：请修复贵方承接实现，work item 缺失时对新事件执行幂等投影而非 400。

---

**【第四部分】下一步（我方侧已就绪，等待贵方两个动作）**

1. 贵方确认 pull 凭证已切 c2m- → 触发 auto-discover Sync → work item 投影入账；
2. 贵方书面澄清 work item 缺失语义（400 拒绝 or 幂等投影）。

任一完成后我方立即重推 open task（姿势已备好：完整信封 + 全新 event_id），目标 200 ACK + 贵方商机投影 + 我方 outbox 记 `success`，完成 M→C 端到端验收闭账。

—— Marketplace 团队
