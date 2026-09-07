**主题：联调综合回复——W3 席位快照口径升级（贵方零改动）+ push 重推 400 根因定位与语义确认**

Marketplace 团队各位好：

两件事一并回复：

---

**【第一部分】W3 席位快照 workspace_avatar_url 口径升级——改发可渲染地址（贵方零改动）**

就此前《Re Workspace 档案发现提案 答复》第四节与贵方约定的 W3 avatar 渲染口径，我方做了一次单向升级，无需贵方任何开发改动：

**1. 口径变更内容**：`submit_bid` 请求体 `workspace_avatar_url` 字段值从"Console 存储原值（对象存储 URL 或站点相对路径）"升级为**解析后可渲染地址**：站点相对 `/api/avatars/<sig>/<key>`，或在我方配置了 `MULTICA_PUBLIC_URL` 时为对应的绝对地址。签名 `<sig>` 为 storage key 的确定性 HMAC（**无 TTL**），URL 长期稳定可渲染。契约权威文档 `employer-integration-api.md` §21.4 已同步回写。

**2. 贵方现有渲染逻辑天然兼容、无需改动**：相对路径（`/api/avatars/...` 开头）→ 按既有约定回退 W1 详情 `avatar_url`（我方 W1 返回的同样是解析后可渲染地址）；绝对地址（配置 `MULTICA_PUBLIC_URL` 后的形态）→ 直接渲染。

**3. 时点语义不变**：签名覆盖 storage key 且无 TTL，地址仍指向**投标时点上传的那个对象**；头像重传即新对象新 key = 新地址，各投标记录的快照仍冻结于各自投标时点——与既有 §21.4 快照语义一致。

**4. 原"相对路径样本"请求自然消解**：升级后首场联调的**真实竞标流量本身即为样本**（`workspace_avatar_url` 将以 `/api/avatars/...` 形态出现在真实 submit_bid 请求中），无需另行构造。

---

**【第二部分】push 重推 400——根因已定位（重推请求 payload 为空），非 workspace 配置问题；附 push 语义书面确认**

贵方反馈已收到，我方在 beta 环境完成了逐条取证，结论与贵方的推断有出入，请看实据：

**1. 400 的真实根因：贵方重推请求的 payload 为空（非 workspace 配置问题）**

- 我方入站事件台账（`inbound_webhook_events`）显示：09-04 12:51 以来的**全部 8 次重推请求，payload 哈希均为空**（即 HTTP body 无事件数据，只有空壳）。
- 我方 webhook 承接对空 body 请求走"事件重放（replay）"分支：按 `event_id` 查找已入账的历史工作项——贵方重推用的是**全新 event_id**，我方从未入账过该 id，自然查无此件，返回 400。这与 workspace 配置（`receive_platform_push` / `auto_discover_opportunity` / `capability_tags`）**无关**——该 workspace 的 `receive_platform_push` 自始就是开启的。
- **请贵方检查重推动作的请求体构造**，二选一：
  - **当作新事件投递**：完整 payload（§9.1 信封含 `data.task_brief` 等）+ 全新 `event_id` —— 我方按正常承接流程幂等投影；
  - **真重放死信**：空 payload + **原始** `event_id`（不是新 id）—— 我方按 event_id 找回已入账工作项重放。
  此前 8 次重推均为"空 payload + 全新 event_id"组合，两头不匹配，必然 400。

**2. push 语义书面确认（贵方第二问）**

- 我方 push 承接带 **workspace 级接收开关**（`receive_platform_push`，产品语义：Agent Owner 自主控制是否接收平台推送商机）：**开启** = 幂等投影商机（即契约 §9.1"创建商机记录"语义）→ 200 ACK；**关闭**（或 workspace 未注册）= 200 ACK 静默消费不投影（防贵方 re-push 风暴，非拒绝、非 400）。
- **push 承接不依赖 pull/Sync 的投影产物**——两者是独立通道（push=定向事件、pull=大厅枚举），贵方无需"等 Sync 先投影"再重推。
- 该开关语义为我方契约 §9.1 未写明的实现细节，我方将按 §7.1 回写契约文档（§9.1 补 push 接收条件与两分支行为说明），无需贵方动作。

**3. 测试 workspace 配置已补齐**

`beta-ac4-ws` 现状：`receive_platform_push = true`（本就开启）、`auto_discover_opportunity = true`（本轮补开）、`capability_tags = ["web"]`（本轮补配）——push 与 pull 双通道的就绪条件均已满足。

**4. 请重推（修正请求体后）**

请按上文"当作新事件投递"姿势（完整 payload + 全新 event_id）重推 open task → 我方 200 ACK + 商机投影 → 贵方 outbox 记 `success`，即完成 M→C 端到端验收闭账。

另：`c2m-` 方向密钥值我方将按约定经联调群加密渠道发送（贵方入站验签回切单密钥口径后，我方 W2 生命周期事件推送即可通过贵方 HMAC 门）。

—— Agent Owner Console 团队