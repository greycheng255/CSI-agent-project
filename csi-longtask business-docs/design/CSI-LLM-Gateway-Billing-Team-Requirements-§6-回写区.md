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
| **E5** capabilities | GET | `/v1/entitlement/capabilities` | `entitlement.controller.ts` | ✅ |
| **E6** 订阅生命周期 | POST | `/v1/entitlement/subscriptions`（body: `action`/`org_id`/`plan_code`） | `entitlement.controller.ts:190` | ✅ |
| **E7** LLM 凭证 | GET | `/v1/entitlement/llm-config/:orgId` | `entitlement.controller.ts:167` | ✅ |
| **K1** 签发 | POST | `/v1/gateway/keys`（body: `org_id`/`workspace_id`） | `gateway-keys.controller.ts:16` | ✅ |
| **K2** 验签 | POST | `/v1/gateway/keys/validate`（body: `key`） | `gateway-keys.controller.ts:40` | ✅ |
| **K3** 吊销 | POST | `/v1/gateway/keys/:keyId/revoke` | `gateway-keys.controller.ts:34` | ✅ |
| **K4** 轮换 | POST | `/v1/gateway/keys/:keyId/rotate` | `gateway-keys.controller.ts:28` | ✅ |
| **L1** 聊天 | POST | `/v1/chat/completions`（头: `X-Workspace-Key`/`X-Agent-Run-Id`） | `gateway-bridge.controller.ts:75` | ✅ |
| **L2** 向量化 | POST | `/v1/embeddings`（头: `X-Workspace-Key`） | `gateway-bridge.controller.ts:90` | ✅ |
| **L3** 模型目录 | GET | `/v1/models`（头: `X-Workspace-Key`） | `gateway-bridge.controller.ts:104` | ✅ |
| **L2'** 计量上报 | POST | `/v1/entitlement/usage-records`（body: `org_id`/`items[]`） | `entitlement.controller.ts:72` | ✅ |

K 族契约别名：`POST /v1/keys/issue`、`POST /v1/keys/revoke`、`POST /v1/keys/:keyId/rotate`（`gateway-bridge.controller.ts:36-53`），与主路径等效。

---

## 6.4 联调期 org_id 测试值约定

| 项 | 定案 |
|---|---|
| org_id 测试值 | **同意贵方草案**：`org-with-plan`（含套餐，正常链路）/ `org-no-plan`（无套餐，触发 `ENTITLEMENT_PLAN_NOT_FOUND` 404）。需先经 `POST /v1/entitlement/subscriptions {action:"activate",org_id:"org-with-plan",plan_code:"free"}` 激活。 |

> `org_id` 为 varchar 类型（非 UUID 硬约束），但 E4 的 `workspace_id` 必须是 UUID 格式（`requireUuid()` 校验）。

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

**结构**：RFC 7807 兼容 problem+json：
```json
{
  "type": "about:blank",
  "title": "<error_code>",
  "status": <int>,
  "detail": "<message>",
  "instance": "<request_path>",
  "request_id": "<uuid>",
  "error_code": "<CODE>"
}
```

**可重试判定**：`RATE_LIMIT_` / `UPSTREAM_` / `INTERNAL_` 前缀可重试；其余不可重试。

| 前缀 | code | HTTP |
|---|---|---|
| AUTH | `AUTH_TOKEN_INVALID` / `AUTH_HMAC_SIGNATURE_MISMATCH` / `AUTH_TIMESTAMP_EXPIRED` / `AUTH_NONCE_MISSING` | 401 |
| VALIDATION | `VALIDATION_INVALID_PAYLOAD` / `VALIDATION_GATE_NOT_PASSED` / `INVALID_ARGUMENT` | 400 |
| NOT_FOUND | `NOT_FOUND_TASK` / `NOT_FOUND_ORDER` / `NOT_FOUND_WORKSPACE` | 404 |
| CONFLICT | `CONFLICT_SEAT_FULL` / `CONFLICT_SPEC_VERSION_CONFLICT` / `CONFLICT_DUPLICATE` / `CONFLICT_WORKSPACE_SLUG` / `CONFLICT_SETTLEMENT_ALREADY_TRIGGERED` | 409 |
| STATE | `STATE_INVALID_TRANSITION` / `STATE_PROJECT_NOT_DELIVERABLE` / `COUNTER_PROPOSAL_UNSUPPORTED` | 422 |
| ENTITLEMENT | `ENTITLEMENT_PLAN_NOT_FOUND` / `ENTITLEMENT_LIMIT_REACHED` / `ENTITLEMENT_CATALOG_DENIED` / `ENTITLEMENT_QUOTA_EXHAUSTED` | 404/403/403/402 |
| LLM | `LLM_CONFIG_MISSING` / `LLM_CONFIG_INVALID` / `LLM_CONFIG_DECRYPT_FAILED` / `LLM_UPSTREAM_ERROR` | 404/422/502/502 |
| RATE_LIMIT | `RATE_LIMIT_TOO_MANY` | 429 |
| UPSTREAM | `UPSTREAM_UNREACHABLE` | 502 |
| INTERNAL | `INTERNAL_ERROR` | 500 |

代码：`errors.ts` 契约错误码全量定义；`entitlement-errors.ts` 权益错误码。

---

## 6.9 测试数据预置确认（D1-D6）

| 项 | 定案 |
|---|---|
| 预置方 | **Marketplace 侧负责** |
| 预置内容 | ① 激活测试 org：`POST /v1/entitlement/subscriptions {action:"activate",org_id:"org-with-plan",plan_code:"free"}`；② 预置 D1-D6 大厅任务 + bid 数据 |
| 预置时间 | 2026-09-09 前 |
| workspace_id 格式 | 必须 UUID（E4 入参校验 `requireUuid()`） |

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
