**主题：Re: M2C 验收闭账确认 + 契约回写三处逐项答复——W1 场景一双向闭环达成**

Marketplace 团队各位好：

贵方两份回函已收悉并逐项核对。**M→C 端到端验收我方确认闭账**，契约三处回写状态逐项答复如下。

**一、M→C 验收闭账确认（我方台账互证）**

贵方 09-07 07:27:51 UTC 重推的 2 条 `opportunity.pushed`，我方入站台账均为 **processed / 200 / 载荷哈希落库**，与贵方 outbox `success / attempts=0` 双向互证——M→C push 承接全链（HMAC 门 → 信封解析 → 工作项入账 → 异步消费）首次真实闭环。两点行为说明（均为契约设计行为，非失败）：

1. 指向 beta-ac4-ws 的那条未新增商机投影行：贵方重推的 task `029a85da` 已被 pull 通道投影（09-06），push 到达同 (workspace, task) 触发 §9.1 幂等去重静默跳过——pull 与 push 双通道对该 task 均已承接，投影行只有一行是正确结果；
2. 指向 workspace `611417be` 的那条被静默消费：该 workspace 未在我方注册（我方无 FK 硬约束，为防悬挂投影行按"未注册即消费不投影"处理）。贵方若需要该 workspace 参与投影，请按对接流程在我方注册或改推已注册 workspace。

**二、契约回写三处逐项答复（对应贵方核对请求）**

1. **§21.4 avatar 口径：已回写属实**——09-05 22:14 我方 commit 已落（解析后可渲染地址口径，签名无 TTL）。贵方副本停在 17:52，**属副本滞后**，最新版将随本函同步（见第四节）。
2. **§9.1 push 接收开关两分支：确属未回写，我方欠账**——本轮契约回写 patch 一并补齐（§9.1 处理逻辑补 `receive_platform_push` 开关语义：开启 = 幂等投影；关闭/未注册 = 200 静默消费）。
3. **§10.1 金额口径：按贵方确认的口径 A（整数元）回写**——本次回写覆盖 `price_cny` / `budget_range.min / max` / 结算 `amount_cny` / 里程碑 `amount` / 仲裁 `partial_settlement`（统一 int 人民币元取整，字段名保留 `*_cny`）；同时把 submit_bid 实测形态（请求 `price_cny` 正整数 + 响应 camelCase 嵌套 `bid{}`）一并回写 §10.1。我方客户端现实现即整数元，零改动对齐。

在途回写项另有一处：`bid_estimated_days` → 按贵方答复以 `estimated_delivery_at` 为准（贵方不消费 `bid_estimated_days`），我方请求侧字段调整随本轮回写一并进行。

**三、其余确认事项**

1. cancel_request 对账扩展键交付收到，结构已知悉（键恒出现、无请求时 null）——我方 DTO 字段名对齐（`cancel_request_id/cancel_proposal_seq/trigger/owner_response/resolution/created_at`）列入场景八对账接入项；
2. 网关计费前置答复收到：E4 增量游标语义（keyset + 本页增量聚合）、cost_cents 帧内嵌、K3 no-op 成立、org 级批量暂不支持（逐 workspace 拉取累加）均已记录，我方 E4 对账实现按增量口径对齐后排期阶段 1 冒烟（E1-E4 + K3）；沙箱凭证收到后启动；
3. 三份文档副本（runbook / dev-plan / skill）收到致谢，逐字段核对后如有差异按 §7.1 提变更请求。

**四、契约副本同步**

最新版 `employer-integration-api.md`（含 §21.4 新口径 + §21 全节 + 本轮 §9.1/§10.1 回写）随本函经联调群直发。后续双方以联调群共享为同步机制，重大口径变更仍按 §7.1 走正式变更请求。

—— Agent Owner Console 团队
