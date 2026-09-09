# 6. 网关团队回写区（契约核对阶段填写）

> 填写时间：2026-09-09  
> 填写方：Marketplace 团队  
> 依据：代码实现（commit `edcf4ca`），远程实例 122.51.51.177:4001 实测

---

## 6.1 沙箱/生产 base URL

| 项 | 定案 |
|---|---|
| 沙箱/生产 base URL | **联调窗口：`http://122.51.51.177:4001`**（NestJS 后端，HTTP 可达）。生产 K8s 地址另行提供。前端 `:5173`。 |

2026-09-08 实测：全部 15 路由返回 401（鉴权拦截），服务已部署最新代码。

---

## 6.2 服务间认证机制与凭证分发

| 项 | 定案 |
|---|---|
| 认证机制 | **HMAC-SHA256 四步验签**（`hmac.guard.ts`）：① Bearer token 比对 → ② timestamp 偏差 ≤ 5min → ③ nonce（X-Request-Id）唯一去重 → ④ HMAC-SHA256(body 原文 + ts) 重算 |
| 凭证分发 | 密钥 `LONGTASK_INBOUND_TOKEN`（c2m- 方向密钥，Bearer + HMAC 共用同一密钥），联调期线下交换 |
| 签名头格式 | `X-Signature: t=<unix_ts>,v1=<hex 64位小写>` |
| 请求头 | `Authorization: Bearer <token>` + `X-Signature` + `X-Request-Id`（uuid-v4/v7，每次新生成，重试必须更换） |
| 写操作幂等 | 加 `Idempotency-Key`（同一逻辑写内不变） |
| 过渡兼容 | 支持 `LONGTASK_INBOUND_TOKEN_LEGACY` 旧凭证并行（2026-09-07 切换，对端确认后移除） |

代码：`hmac-sign.ts` `signPayload(payload + ts, secret)` → hex；`hmac.guard.ts:35-40` 密钥候选序。

---

## 6.3 接口路径与字段命名（E1-E6/L1-L3/K1-K4 映射表）

| 端点 | 方法 | 路径 | 实现文件 | 状态 |
|---|---|---|---|---|
| **E1** 套餐 | GET | `/v1/entitlement/plans/:orgId` | `entitlement.controller.ts:37` | ✅ |
| **E2** 目录 | GET | `/v1/entitlement/catalogs/:orgId` | `entitlement.controller.ts:48` | ✅ |
| **E3** 额度 | GET | `/v1/entitlement/quotas/:orgId` | `entitlement.controller.ts:60` | ✅ |
| **E4** 用量 | GET | `/v1/entitlement/workspaces/:workspaceId/usage?period_start&period_end&cursor&limit` | `entitlement.controller.ts:82` | ✅（已修复 500） |
| **E4** 别名 | GET | `/v1/entitlement/usage?workspace_id=&period_start=&period_end=` | `entitlement.controller.ts:100` | ✅ |
| **E5** capabilities | GET | `/v1/entitlement/capabilities` | `entitlement.controller.ts:135` | ✅（返 `{version,features:{incremental_usage_cursor,run_level_usage,free_quota_activation,workspace_level_keys,byok}}`） |
| **E6** 订阅生命周期 | POST | `/v1/entitlement/subscriptions`（body: `action`/`org_id`/`plan_code`） | `entitlement.controller.ts:279` | ✅ |
| **E6'** 免费额度激活 | POST | `/v1/entitlement/free-quota/activate`（body: `org_id`，幂等） | `entitlement.controller.ts:151` | ✅（不传 plan_code，走 env `ENTITLEMENT_DEFAULT_PLAN=beta-free`） |
| **E7** LLM 凭证 | GET | `/v1/entitlement/llm-config/:orgId` | `entitlement.controller.ts:179` | ✅ |
| **K1** 签发 | POST | `/v1/gateway/keys`（body: `org_id`/`workspace_id`） | `gateway-keys.controller.ts:16` | ✅ |
| **K2** 验签 | POST | `/v1/gateway/keys/validate`（body: `key`） | `gateway-keys.controller.ts:40` | ✅ |
| **K3** 吊销 | POST | `/v1/gateway/keys/:keyId/revoke` | `gateway-keys.controller.ts:34` | ✅ |
| **K4** 轮换 | POST | `/v1/gateway/keys/:keyId/rotate` | `gateway-keys.controller.ts:28` | ✅ |
| **L1** 聊天 | POST | `/v1/chat/completions`（头: `X-Workspace-Key`/`X-Agent-Run-Id`） | `gateway-bridge.controller.ts:75` | ✅ |
| **L2** 向量化 | POST | `/v1/embeddings`（头: `X-Workspace-Key`） | `gateway-bridge.controller.ts:90` | ✅ |
| **L3** 模型目录 | GET | `/v1/models`（头: `X-Workspace-Key`） | `gateway-bridge.controller.ts:104` | ✅ |
| **L2'** 计量上报 | POST | `/v1/entitlement/usage-records`（body: `org_id`/`items[]`） | `entitlement.controller.ts:169` | ✅ |

K 族契约别名（`gateway-bridge.controller.ts:36-53`）：
- **K1 别名** `POST /v1/keys/issue`（body: `org_id`/`workspace_id`）
- **K3 别名** `POST /v1/keys/revoke`（body: `key_id`，**非 path 形态**；M 侧实测 `POST /v1/keys/:id/revoke` 返 404 Cannot POST 属预期——revoke 走 body）
- **K4 别名** `POST /v1/keys/:keyId/rotate`（path 形态）

> 修订记录（2026-09-09）：①E4 旧 `from`/`to` 形态已废弃——当前 query 别名仅认 `period_start`/`period_end`，缺参 → 400（edcf4ca 修复，重部署后生效，旧 `from`/`to` 不再 500）；②E5 已登记返能力对象（原 spec 标"⏳"系版本差）；③E6 补 `free-quota/activate` 形态 + plan_code=`beta-free`（env 驱动）；④K3 别名澄清为 body 形态。

---

## 6.4 联调期 org_id 测试值约定

| 项 | 定案 |
|---|---|
| org_id 类型 | **UUID（硬约束）**。所有 E 族路由入参经 `requireUuid()` 校验，非 UUID → 400 `INVALID_ARGUMENT`（避免 PG uuid 列解析炸成 500）。DB 列 `org_id` 为 `uuid` 类型。 |
| 测试值（方案②） | `00000000-0000-4000-8000-00000000e001`（含套餐，正常链路）/ `00000000-0000-4000-8000-00000000e002`（无套餐，触发 `ENTITLEMENT_PLAN_NOT_FOUND` 404） |
| 激活 | `POST /v1/entitlement/free-quota/activate {"org_id":"<e1 UUID>"}`（幂等，入驻即赠免费额度） |
| plan_code | 实际套餐 code 为 **`beta-free`**（由 env `ENTITLEMENT_DEFAULT_PLAN` 设定，非字面 `free`）；`free-quota/activate` 不传 plan_code 走默认，`subscriptions` 形态需传 `plan_code:"beta-free"` |

> 修订记录（2026-09-09）：原回写声明 org_id 为 varchar/无 UUID 约束与线上 `requireUuid()` 校验矛盾，经 M 侧实测指出。现改为方案② UUID 测试值，代码不变。

---

## 6.5 计价币种与精度

| 项 | 定案 |
|---|---|
| 计价币种 | **人民币（CNY），整数分（cents）** |
| 精度 | 全部金额字段为 `integer` 类型，`Math.round()` 取整 |
| 估算单价表 | `gpt-5.4`：输入 200 分/百万 tokens · 输出 800 分/百万 tokens；`gpt-5.5`：输入 400 · 输出 1600。未登记模型回退 gpt-5.4 |
| Console 落账 | 整数分 |

代码：`llm-proxy.service.ts:37-46` `MODEL_UNIT_PRICES` + `estimateCostCents`。

---

## 6.6 E4 拉取形态：org 级/批量查询 + 增量游标语义

| 项 | 定案 |
|---|---|
| workspace 级（主路径） | `GET /v1/entitlement/workspaces/:workspaceId/usage?period_start&period_end&cursor&limit`，增量游标语义 = **自 cursor 起增量**（`WHERE id > cursor ORDER BY id ASC LIMIT 500`），返回 `cursor` 为末行 id |
| 空态行为 | **无用量记录时返回 200 空集合**（`items: []`, `cursor: "0"`, `requests: 0`） |
| org 级批量 | `EntitlementService.getUsageForOrg(orgId, periodStart, periodEnd)`，一次拉取 org 下全部 workspace 用量（含无活动），返回 org 总计 + 每 workspace 分组。当前仅在 service 层实现，controller 路由待确认是否暴露 |
| 参数校验 | `period_start`/`period_end` 缺失或非法 → 400 `INVALID_ARGUMENT`（2026-09-09 修复，此前为 500） |

代码：`entitlement.service.ts:162-201` workspace 级 `getUsage`；`entitlement.service.ts:208-289` org 级 `getUsageForOrg`。

---

## 6.7 workspace 级 LLM key 签发/轮换/CIDR 配置（K1-K4）

| 项 | 定案 |
|---|---|
| K1 签发（幂等） | 同 workspace 重复调用返回同一 active key（`existing=true`，解密原样返回明文）。key 格式 `sk-csi-<base64url(24 bytes)>`，AES-256-GCM 密文存储，明文仅此响应一次 |
| K2 验签 | daemon 用 key 换取 `{valid, workspace_id, org_id, key_id}`，SHA-256 hash 查找，非 active → `valid=false` |
| K3 吊销 | 即时 `status=revoked` + `revoked_at`，不可逆 |
| K4 轮换 | 旧 key 置 `rotated`，新 key `rotated_from_id` 指向旧 key。每 workspace 同时只有一个 `active` key |
| CIDR 配置 | 当前未实现 IP 白名单/CIDR 限制（公测期不设限），如贵方需要请提出 |

代码：`gateway-keys.service.ts:83-115` K1 / `163-180` K2 / `148-157` K3 / `118-145` K4；`gateway-key.entity.ts` entity 定义。

---

## 6.8 错误结构与 code 清单

**结构**：RFC 7807 兼容 problem+json（全局过滤器 `Rfc7807Filter` 渲染，**以此为准**）：
```json
{
  "type": "about:blank",
  "title": "<message>",
  "status": <int>,
  "detail": "<message>",
  "instance": "<request_path>",
  "request_id": "<uuid>",
  "error_code": "<CODE>"
}
```
> 修订记录（2026-09-09）：M 侧所引原始契约 spec 声明 `{status, code, message, details?, retry_after_seconds?}` 系旧稿；线上实际由 `Rfc7807Filter`（`longtask/contract/rfc7807.filter.ts`，`APP_FILTER` 全局注册）统一输出 RFC 7807 形态，字段名为 `error_code`/`title`/`detail`。客户端错误映射请按 `error_code` 字段工作。`details`/`retry_after_seconds` 为可选字段（仅当 `ContractError` 构造时传入才出现）。

**可重试判定**：`RATE_LIMIT_` / `UPSTREAM_` / `INTERNAL_` 前缀可重试；其余不可重试。

| 前缀 | code | HTTP |
|---|---|---|
| AUTH | `AUTH_TOKEN_INVALID` / `AUTH_HMAC_SIGNATURE_MISMATCH` / `AUTH_TIMESTAMP_EXPIRED` / `AUTH_NONCE_MISSING` | 401 |
| VALIDATION | `VALIDATION_INVALID_PAYLOAD` / `VALIDATION_GATE_NOT_PASSED` / **`INVALID_ARGUMENT`** | 400 |
| NOT_FOUND | `NOT_FOUND_TASK` / `NOT_FOUND_ORDER` / `NOT_FOUND_WORKSPACE` | 404 |
| CONFLICT | `CONFLICT_SEAT_FULL` / `CONFLICT_SPEC_VERSION_CONFLICT` / `CONFLICT_DUPLICATE` / `CONFLICT_WORKSPACE_SLUG` / `CONFLICT_SETTLEMENT_ALREADY_TRIGGERED` | 409 |
| STATE | `STATE_INVALID_TRANSITION` / `STATE_PROJECT_NOT_DELIVERABLE` / `COUNTER_PROPOSAL_UNSUPPORTED` | 422 |
| ENTITLEMENT | `ENTITLEMENT_PLAN_NOT_FOUND` / `ENTITLEMENT_LIMIT_REACHED` / `ENTITLEMENT_CATALOG_DENIED` / `ENTITLEMENT_QUOTA_EXHAUSTED` | 404/403/403/402 |
| LLM | `LLM_CONFIG_MISSING` / `LLM_CONFIG_INVALID` / `LLM_CONFIG_DECRYPT_FAILED` / `LLM_UPSTREAM_ERROR` | **404(E7 GET) / 409(L1/L2 调用路径)** / 422 / 502 / 502 |
| RATE_LIMIT | `RATE_LIMIT_TOO_MANY` | 429 |
| UPSTREAM | `UPSTREAM_UNREACHABLE` | 502 |
| INTERNAL | `INTERNAL_ERROR` | 500 |

> 修订记录（2026-09-09）：①`LLM_CONFIG_MISSING` 双状态码——E7 GET `/llm-config/:orgId` 返 404（`entitlement.controller.ts:184`），L1/L2 调用路径返 409（`llm-proxy.service.ts:71,95`，提示"尚未配置 AI Token"）；原清单只标 404 漏了 409；②`INVALID_ARGUMENT` 已在 VALIDATION 族（400），M 侧所引原稿缺漏。

代码：`errors.ts` 契约错误码全量定义；`entitlement-errors.ts` 权益错误码；`rfc7807.filter.ts` 全局渲染。

---

## 6.9 测试数据预置确认（D1-D6）

| 项 | 定案 |
|---|---|
| 预置方 | **Marketplace 侧负责**（test org 激活已脚本化进 `deploy-fix.sh` 5.55+5.6 步；D1-D6 大厅任务 + bid 数据由我方预置） |
| 预置内容 | ① 预置 `beta-free` 套餐（`deploy-fix.sh` 5.55 步，`ON CONFLICT code` 幂等 INSERT）；② 激活 test org：`POST /v1/entitlement/subscriptions {action:"activate",org_id:"00000000-0000-4000-8000-00000000e001",plan_code:"beta-free"}`（或 `POST /v1/entitlement/free-quota/activate {org_id:"<e001 UUID>"}` 走 env 默认）；③ 预置 D1-D6 大厅任务 + bid 数据 |
| 预置时间 | 2026-09-09 前（test org 激活已完成，服务端实测 subscription id `bab50ef2-…`，periodEnd 2026-10-09） |
| workspace_id 格式 | 必须 UUID（E4 入参校验 `requireUuid()`） |

> 修订记录（2026-09-09）：原回写用 `org_id:"org-with-plan"` + `plan_code:"free"`，与 §6.4 修订后的 UUID 测试值 `e001` 和实际 plan_code `beta-free` 矛盾，经 M 侧 §13 核验指出。现统一为 `org_id:"…e001"` + `plan_code:"beta-free"`；补 `beta-free` plan 预置步骤。

代码：`entitlement.service.ts:558-592` `activate()` 入驻激活 + 免费额度即赠。

---

## 附：wire drift 实测形态差异（additive，客户端可兼容）

| 项 | 契约假设 | 实测形态 | 说明 |
|---|---|---|---|
| 错误结构 | `{code, message, retryable, details}` | `{type, title, status, detail, instance, request_id, error_code}` | RFC 7807 problem+json；`error_code` 等价于契约 `code` |
| K1 响应 | — | 增加 `workspace_id` / `status` / `existing` 字段 | additive |
| K2 validate 响应 | — | 增加 `workspace_id` / `org_id` / `key_id` 字段 | additive |
| E1 plan 响应 | — | 含 `free_quota_remaining` / `period_start` / `period_end` / `reset_at` | additive |
| E2 catalog 响应 | — | 模型含 `tier` / `model_type` / `flagship`；顶层含 `runtime_profiles` / `max_cloud_runtime_instances` | additive |
| E3 quota 响应 | — | `remaining_tokens` 为数字，`total_tokens`/`used_tokens` 为字符串；含 `frozen_credits` / `available_credits` / `free_quota{}` 子对象 | 类型混用，additive |
