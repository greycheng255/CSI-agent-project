# M 侧回函：M→C 验收闭账 + submit_bid/金额口径确认 + 网关计费前置答复

> **答复方**：Marketplace（M 侧）
> **日期**：2026-09-07
> **对应来函**：①《Re 联调综合答复》（W3 口径升级 + push 400 根因）；②《Re M 侧——网关与计费能力联调前置请求》
> **结论速览**：**M→C 端到端验收已闭账**（重推 200 ACK 实测）；submit_bid 形态与金额口径本函确认；cancel_request 对账键已交付；网关计费四问答复如第五节。

---

## 一、M→C 端到端验收：已闭账（2026-09-07）

1. 按贵方指引以原姿势重推（完整 §9.1 信封 + 全新 event_id）：**2 条 `opportunity.pushed` 均首投 200 ACK**（M 侧 outbox `success / attempts=0`），命中 workspace 含贵方本轮同步的 beta-ac4-ws。
2. **§8.3 信封统一披露（请知悉）**：M 侧 outbox 投递器已做单点信封装配——调用方传扁平业务体时自动组装信封外层（`event_id / event_type / event_version / occurred_at / sent_at / source: "marketplace" / data`），已自带 `data` 容器的完整信封（§9.1）原样透传。全部 16 条 M→C webhook 均以此形态投递，与贵方本轮修复后的 `data` 键解析对齐。
3. W2 生命周期事件承接端点（§21.3）已就绪：`POST /v1/webhooks/workspace/changed`（HMAC 验签 + `event_id` 去重 + 全量快照幂等 upsert + `deleted` 仅标识处理），贵方探针推送（`CSI F2 probe ws` created/deleted）M 侧已正常承接。

## 二、submit_bid 形态与金额口径确认（对应函件第五节）

1. **响应字段清单确认：与贵方实测一致、无遗漏**：
   - `bid`: `id / marketplaceTaskId / bidRound / workspaceId / workspaceName / workspaceLogoUrl / priceCny / planSummary / estimatedDeliveryAt / status / source / createdAt`（TypeORM 实体 camelCase 直出）
   - 外层: `seatTaken / seatLimit / seatFull / seatFullDeadline`
   - plan 相关仅有 `planSummary` 一个字段，无其它 plan 字段。
2. **`bid_estimated_days`：M 侧不消费**（未建模该字段）。权威字段为请求侧 `estimated_delivery_at`（→ 响应 `estimatedDeliveryAt`）；请贵方后续停发 `bid_estimated_days`，以 `estimated_delivery_at` 为准。
3. **金额口径：确认口径 A——全链统一整数元（int，人民币元取整）**：
   - `price_cny`：`15000` = ¥15,000.00；贵方拉到的 `budget_range.min/max`（10000/20000）**是元**；
   - 结算 `amount_cny`、里程碑 `amount`、仲裁 `partial_settlement` 金额：同为整数元；
   - 字段名保留 `*_cny`（无需改 `*_cny_fen`）；分级精度需求出现时再按 §7.1 升级。
   - 请贵方按本口径回写契约 §10.1 及相关金额字段（§7.1 变更由贵方发起，M 侧评审确认）。

## 三、cancel_request 对账扩展键：已交付（对应函件第六节）

1. `GET /v1/marketplace/orders/{id}/status` 响应现含 `cancel_request` 键（**键恒出现；无取消请求时值为 null**）。
2. 结构（取最新一轮，按 `cancel_proposal_seq` 倒序）：

```json
"cancel_request": {
  "cancel_request_id": "uuid",
  "cancel_proposal_seq": 2,
  "status": "open|accepted|rejected|counter_proposed|finalized|to_dispute",
  "trigger": "string|null",
  "owner_response": "string|null",
  "resolution": "string|null",
  "created_at": "RFC3339"
}
```

3. 贵方取消协商对账兜底无需任何改动，接入即生效。

## 四、文档副本（对应函件第七节）

1. `docs/longtask-integration-runbook.md`、`docs/carbon-silicon-longtask-dev-plan.md`：M 侧仓库 `docs/` 下，随本回函经联调群直发副本。
2. `skill/console_marketplace_integration_skill.md`：M 侧仓库 `skill/` 下，同上直发；贵方逐字段核对后发现的形态差异，按 §7.1 提变更请求，M 侧逐项确认回写。

## 五、网关与计费前置答复（对应《Re M 侧——网关与计费能力联调前置请求》）

1. **四个契约问题答复**：
   - **E4 游标语义：自 cursor 起的增量**（keyset 续拉）。`cursor` = 上一页响应回传的最后一条记录 id，续拉条件 `id > cursor`；每页返回**本页增量聚合**（requests / input_tokens / output_tokens / credits / cost_cents）+ `items` 明细 + 下一页 `cursor`。贵方"全窗聚合"实现需对齐（对账可用 items 明细逐条核，页聚合为增量 sum）。
   - **usage 帧 `cost_cents` 位置：帧内嵌为准**——每条 usage 记录（上报帧 `POST usage-records` 的 items[] 与 E4 响应 items[]）均内嵌 `cost_cents`；E4 响应顶层另有同名聚合字段（本页 sum）供对账快核。贵方 daemon 收敛为内嵌读取即可。
   - **K3 幂等口径：404/401 no-op 假设成立**——重复触碰已吊销 key 返回 200 + `{key_id, status: "revoked"}`（幂等 no-op，不重复记时间）；key 不存在返回 404 `NOT_FOUND`；对账复扫安全。
   - **E4 org 级/批量：当前不支持一次拉 org 全量**（归集键 = workspace_id）。公测期请贵方逐 workspace 拉取后累加；org 维度聚合端点如有需要，请按 §7.1 提变更请求，M 侧评审后排期。
2. **E7 端点澄清**：`GET /v1/entitlement/llm-config/:orgId` 为 M 侧 **BYOK 能力组件**（服务级 HMAC 通道；Console 执行引擎按 org 拉取用户配置的网关 `base_url` + `api_key` 明文，仅此通道可取；未配置返回 404 `LLM_CONFIG_MISSING`）。按贵方 Owner 裁决"BYOK 全部维持冻结契约"——**E7 随 BYOK 一并冻结，暂不纳入契约**；公测期如需启用，M 侧按 §7.1 提交正式变更请求，经贵方评审后接入。
3. **沙箱环境五项（初步值，正式值随 §6 回写区文档补交）**：
   - ① Endpoint：`http://122.51.51.177:4001/v1`（E1-E4 计量对账面已就绪；K 线/E6 随交付接入）；
   - ② 认证：服务级 HMAC 四件套（Bearer / X-Signature / X-Request-Id / Idempotency-Key，与长任务契约同构）；测试凭证经加密渠道另发；
   - ③ 错误结构：RFC 7807（`type / title / status / detail / error_code`，样例见长任务契约 §5）；
   - ④ D1-D6 测试数据：M 侧于贵方阶段 3 启动前预置并回执清单；
   - ⑤ 可达性：4001 公网已通（贵方 pull 在用）；如需 IP 白名单，请提供贵方 dev/beta 出口 CIDR（覆盖 K4），M 侧安全组放行。
4. **《CSI-LLM-Gateway-Billing-Team-Requirements.md》§6 回写区**：M 侧网关同事按上列初步值逐行填写后随函回传（本文档在 M 侧仓库 `docs/design/` 下，本轮未随库同步，回传副本即可）；联调窗口联系人同本函。
5. **联调节奏确认**：E1-E4 计量对账面双方均已实现——贵方可即启阶段 1 冒烟（E1-E6/L1-L3/K1/K3 curl 直测中先做 E1-E4 + K3）；阶段 2-5 按贵方节奏推进，M 侧随时配合。

---

*M 侧联调联系人：（略）；本文档随仓库 `csi-longtask business-docs/design/` 同步。*
