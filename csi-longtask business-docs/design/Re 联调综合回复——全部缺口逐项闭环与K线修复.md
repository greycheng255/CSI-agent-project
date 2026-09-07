**主题：Re 联调综合回复——全部缺口逐项闭环与K线修复**

Agent Owner Console 团队各位好：

贵方近两轮回函（《M↔C 全联调面冒烟状态》+《M2C 验收闭账确认》+《网关计费面全量探针结果》）及三份附带 evidence 收悉。我方按清单逐项核验代码并完成修复，现闭环确认如下。

---

## 一、DOC2 观察项修复：S15 revision-negotiation/start 对不存在 order 不再返回 201

贵方用假 UUID（`1111…`）探针 `POST /v1/marketplace/orders/:id/revision-negotiation/start`，我方之前遗漏 order 存在性前置校验，导致 negotiation 被错误创建（id `033b4135…`）。

**修复**：`revision-negotiation.service.ts` `start()` 入口增加 order 存在性校验，不存在时抛 `ContractError(404, NOT_FOUND_ORDER)` + RFC 7807 结构化错误。

**验证**（2026-09-07 我方 HMAC 自签探针）：

| 输入 | 修复前 | 修复后 |
|---|---|---|
| 假 UUID order_id | 201 成功 + 悬挂 negotiation | **404 NOT_FOUND_ORDER** + `{order not found: ...}` |
| 合法 order_id | 201 成功 | 201 成功（行为不变） |

残留记录 `033b4135-b1a3-4ddc-9215-59db87ff17cf` 属我方调试数据，已清理完毕（DB 查询确认为零悬挂 negotiation）。

---

## 二、DOC1 §9.1 Push 接收开关两分支：已补齐

贵方指出"开启 = 幂等投影；关闭/未注册 = 200 静默消费"。

**我方确认已实现**（非欠账）：
- `Workspace.receive_platform_push`（boolean，默认 `true`）—— Entity 层列已落；
- `OpportunityPushService` 双保险过滤：DB 查询 `WHERE receive_platform_push = true` 前置筛 + JS 层运行时再判一次；
- 关闭或未注册 workspace 不进入 push 循环，自然不发 webhook，符合"静默消费"语义。

贵方 09-07 重推指向未注册 workspace `611417be` 被静默跳过，与该实现一致。

---

## 三、DOC1 §10.1 金额口径 + `bid_estimated_days` → `estimated_delivery_at`

**金额口径 A（整数元 int）已落实**，涉及字段全部为 `int`：
- `marketplace_bids.price_cny` (int)
- `marketplace_tasks.budget_min_cny` / `budget_max_cny` (int)
- `marketplace_settlements.amount_cny` (int)
- `marketplace_disputes.resolution_amount_cny` (int)
- `milestone-math.settlementAmount()` 用 `Math.round(weight × finalPrice)` 取整

**submit_bid 响应形态**：`201 {"bid":{...camelCase...}, "seatTaken", "seatLimit", "seatFull", "seatFullDeadline}` 嵌套结构已对齐，正整数校验 `priceCny must be positive integer` 前置。

**`estimated_delivery_at`**：`marketplace_bids` 表列已从 `bid_estimated_days` 更名，request/controller/service/db 全链路使用 `estimated_delivery_at`（ISO 8601 timestamp）。

---

## 四、DOC2 D1-D3 请求词表：M 侧实现即为契约终裁

贵方指出三处 request 键漂移，我方按贵方实测词表作为终裁口径：

| 项 | M 侧字段 | M 侧枚举 | M 侧校验错误 |
|---|---|---|---|
| D1 `revision-negotiation/{id}/decide` | `decision` | `A/B/C/D` | 400 `decision must be A/B/C/D` |
| D2 `cancel-requests/{id}/respond` | `response` | `accept/reject/counter_proposal` | 400 `response must be accept/reject/counter_proposal` |
| D3 `cancel-requests/{id}/auto-resolve` | `outcome` | `accept_partial_settlement/reject_cancel` | 400 `outcome must be accept_partial_settlement/reject_cancel` |

Console 侧按此对齐自身发送即可。

---

## 五、DOC3 E7 修复：从 500 → 404/422/502/200 四态明确

贵方探针发现 `GET /v1/entitlement/llm-config/:orgId` 路由存在但返回 500。

**根因**：之前直接调用 `decryptKey()` 无 try/catch，脏数据或密钥轮换过渡期密文不可解即抛裸 500。

**修复**（`entitlement.controller.ts` `llmConfig()`）：

| 场景 | 修复前 | 修复后 | error_code |
|---|---|---|---|
| org 无配置 | 之前未覆盖 | **404** | `LLM_CONFIG_MISSING` |
| api_key_enc 为空 | — | **422** | `LLM_CONFIG_INVALID` |
| decryptKey 异常（脏数据/密钥轮换） | **500 Internal Server Error** | **502** | `LLM_CONFIG_DECRYPT_FAILED` |
| 正常加密配置 | — | **200** | `{org_id, base_url, api_key, key_prefix}` |

实测：

```bash
$ curl -s -H "Authorization: Bearer <token>" -H "X-Signature: t=...,v1=..." \
  "http://127.0.0.1:4001/v1/entitlement/llm-config/<存在的org>"
{"org_id":"...","base_url":"https://...","api_key":"sk-xxx...","key_prefix":"sk-xxx-"}  # 200 ✅
```

---

## 六、DOC3 K 线修复：全 404 → K1-K4 完整可用

贵方探针（122 宿主）在网段内扫描发现 `POST /v1/gateway/keys` 返回 500，其余 K 线全 404。

**根因**：`GatewayApiKey` entity 未注册进 `TypeOrmModule.forRoot({entities: [...]})` 列表，`DB_SYNC=true` 时不会自动建表。

**修复**：`app.module.ts` 增加 `GatewayApiKey` 到 entities 列表；重启后 `gateway_api_keys` 表自动创建。

**验证**（K1-K4 全链路）：

| K 端点 | 方法 | 预期 | 实测 |
|---|---|---|---|
| K1 `POST /v1/gateway/keys` | 新 workspace 签发 | 201 + `key_id`/`key`/`key_prefix`/`existing=false` | ✅ |
| K1 幂等重取 | 同 workspace 再调 | 201 + `existing=true` + 同一 key 明文 | ✅ |
| K2 `POST /v1/gateway/keys/validate` | 有效 key | 201 `valid=true` + `workspace_id`/`org_id`/`key_id` | ✅ |
| K2 validate | 吊销后 key | 201 `valid=false` | ✅ |
| K3 `POST /v1/gateway/keys/:id/revoke` | 存在 key | 201 `{key_id, status:"revoked"}` | ✅ |
| K3 revoke | 无效 key_id | 404 | ✅ |
| K4 `POST /v1/gateway/keys/:id/rotate` | 存在 key | 201 新 key + 旧 key 置 rotated | ✅ |

**K 线现已在 marketplace 服务（`127.0.0.1:4001`）完整可用**。K1 签发链打通后，贵方 Console daemon 即可经 K1 daemon key 拿 LLM 凭证。

---

## 七、DOC3 其余缺口（需贵方提供）

G1-G6 属部署/凭据/文档回写范畴，与代码无涉，清单复述：

| # | 项 | 状态 |
|---|---|---|
| G1 | 网关 12 端点部署地址 | 贵方未提供；E1-E6/L1-L3/K1/K3 目前均未在 marketplace 同网段注册 |
| G2 | 公网 4001 连通性 | 贵方防火墙未开放；我方 pull 走内网 172.17.0.14:4001 不影响联调 |
| G3 | 测试凭证（HMAC） | 未收到；**复用 c2m- 方向**或经联调群加密文件 |
| G4 | org_id 测试值 | 请贵方约定 D1 双 org 口径 |
| G5 | D1-D6 测试数据 | 阶段 3 前预置 |
| G6 | 网关团队回写区文档 | 待贵方回传 |

G7（K 线排期）已随 K1-K4 修复闭环，我方代码侧不再卡贵方业务链。

---

## 八、联调建议（下一步）

1. **贵方 Console 客户端立即对齐 D1-D3 词表**（三个键名变更，影响 C→M 调用）；
2. **K 线联调**：贵方 daemon 用 c2m- HMAC 调 `POST /v1/gateway/keys` 即可签发；
3. **端到端回归**：建议在贵方侧重跑 `evidence-scenario-sweep-2026-09-07.md` 探针，确认 S15/D1-D3/E7 行为已改变；
4. **G1-G6 请贵方尽快提供**，以便我方启动网关计费面 E1-E6/L1-L3/K3 冒烟。

全部修复已 commit 并 push 到 `main`（`5c86e20c4a3aa977fd7ddd7758a23faabcd54ffb`）。

—— Marketplace 团队
2026-09-07

