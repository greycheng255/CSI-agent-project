# Console ↔ Marketplace 套餐对接指南

> 版本：v1.0  
> 日期：2026-09-09  
> 适用：Console（Agent Owner Console 团队）读取 Marketplace 侧账户订阅套餐与 LLM 凭证  
> 实例：联调期 `http://122.51.51.177:4001`（NestJS 后端，HTTP）  
> 凭证：HMAC-SHA256 共享密钥 `LONGTASK_INBOUND_TOKEN`（联调窗口线下交换）

---

## 一、对接概览

Console 读套餐涉及 5 个端点，按调用顺序：

| 序 | 端点 | 用途 | 调用时机 |
|---|---|---|---|
| 1 | `GET /v1/entitlement/plans/:orgId` (E1) | 当前订阅套餐 + LLM 配置摘要 | 启动/刷新订阅页 |
| 2 | `GET /v1/entitlement/llm-config/:orgId` (E7) | LLM 凭证明文（base_url + api_key） | 派发 runtime 前 |
| 3 | `GET /v1/entitlement/catalogs/:orgId` (E2) | 模型目录 + runtime profile | 创建智能体页 |
| 4 | `GET /v1/entitlement/quotas/:orgId` (E3) | 实时额度（token/credits/冻结） | Pre-dispatch + 计费面板 |
| 5 | `GET /v1/entitlement/workspaces/:ws/usage` (E4) | 用量账单（增量游标） | 对账 job（每 5min） |

> **LLM 链路**：L1/L2/L3 由 Marketplace 侧 `llm-proxy` 代理转发，Console 只需把 workspace key 注入请求头（`X-Workspace-Key`），无需在 Console 侧持有 LLM api_key。E7 仅用于 runtime 启动时注入环境变量。

---

## 二、鉴权（HMAC-SHA256 四步验签）

所有 E 族端点经 `HmacGuard` 守卫，需四个请求头：

| 头 | 格式 | 说明 |
|---|---|---|
| `Authorization` | `Bearer <token>` | token = `LONGTASK_INBOUND_TOKEN`（联调期线下交换） |
| `X-Signature` | `t=<unix_ts>,v1=<hex 64位小写>` | HMAC-SHA256 签名 |
| `X-Request-Id` | `<uuid-v4/v7>` | nonce，每请求新生成，重试必须更换（窗口内重放即拒） |
| `Idempotency-Key` | `<string>` | 仅写操作（POST）必加，同一逻辑写不变 |

### 签名算法

```
raw_payload = 请求 body 原文（GET/无 body = 空串 ""）
signature_v1 = HMAC-SHA256(key=LONGTASK_INBOUND_TOKEN, msg=raw_payload + ts)
```

**关键点**：
- payload 与 ts **拼接**（无分隔符）：`HMAC(raw_payload + ts, secret)`
- GET 请求 payload = 空串，即 `HMAC("" + ts, secret)` = `HMAC(ts_string, secret)`
- ts 为 unix 秒（10 位），偏差 ≤ 5 分钟（300s）
- nonce 落 `hmac_nonces` 表去重，TTL 10 分钟

### Node.js 示例

```javascript
const crypto = require('crypto');

const TOKEN = process.env.LONGTASK_INBOUND_TOKEN; // 联调窗口线下交换
const ORG_ID = '00000000-0000-4000-8000-00000000e001'; // 测试 org（含套餐）

function sign(payload, ts) {
  return crypto.createHmac('sha256', TOKEN)
    .update(payload + ts)
    .digest('hex');
}

async function hmacGet(path) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = sign('', ts); // GET 无 body，payload=空串
  const url = `http://122.51.51.177:4001${path}`;
  const r = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'X-Signature': `t=${ts},v1=${sig}`,
      'X-Request-Id': crypto.randomUUID(),
    },
  });
  return { status: r.status, body: await r.json() };
}

async function hmacPost(path, body) {
  const payload = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = sign(payload, ts);
  const url = `http://122.51.51.177:4001${path}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'X-Signature': `t=${ts},v1=${sig}`,
      'X-Request-Id': crypto.randomUUID(),
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: payload,
  });
  return { status: r.status, body: await r.json() };
}
```

### curl 示例

```bash
TOKEN="c2m-..."  # 联调窗口线下交换
TS=$(date +%s)
SIG=$(printf '%s%s' "" "$TS" | openssl dgst -sha256 -hmac "$TOKEN" -hex | sed 's/.*= //')
curl http://122.51.51.177:4001/v1/entitlement/plans/00000000-0000-4000-8000-00000000e001 \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Signature: t=$TS,v1=$SIG" \
  -H "X-Request-Id: $(uuidgen)"
```

---

## 三、E1：当前订阅套餐（含 LLM 配置摘要）

Console `/settings/billing` 页与 Pre-dispatch 阶段调用。

### 请求

```
GET /v1/entitlement/plans/:orgId
GET /v1/entitlement/plan?org_id=<orgId>   # query 别名
```

- `orgId`：用户 org id（UUID 硬约束，非 UUID → 400 `INVALID_ARGUMENT`）

### 响应（200）

```json
{
  "id": "e8863ad8-00d6-4c2b-b746-8af7d51f5202",
  "code": "beta-free",
  "name": "公测免费套餐",
  "status": "active",
  "free_quota_remaining": 1000000,
  "period_start": "2026-09-09T06:44:36.899Z",
  "period_end": "2026-10-09T06:44:36.899Z",
  "reset_at": "2026-10-09T06:44:36.899Z",
  "llm_config": {
    "base_url": "http://212.129.240.112:4200",
    "key_prefix": "sk-7cb9ef",
    "source": "plan_builtin"
  }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | string | 套餐 code（联调期 `beta-free`） |
| `status` | string | `active` / `expired` / `suspended` |
| `free_quota_remaining` | number | 免费额度剩余 tokens |
| `period_start`/`period_end` | ISO 8601 | 订阅周期（额度滚动重置锚点） |
| `reset_at` | ISO 8601 | 额度重置时间 = period_end |
| `llm_config` | object? | LLM 配置摘要（仅当 plan 有内置配置时出现） |
| `llm_config.base_url` | string | LLM 网关地址 |
| `llm_config.key_prefix` | string | 明文 key 前缀（掩码展示用，如 `sk-7cb9ef`） |
| `llm_config.source` | string | `plan_builtin`（套餐内置）/ `byok`（用户自配，E1 不返此形态） |

### 错误

| HTTP | error_code | 场景 |
|---|---|---|
| 400 | `INVALID_ARGUMENT` | orgId 非 UUID |
| 401 | `AUTH_TOKEN_INVALID` 等 | HMAC 验签失败 |
| 404 | `ENTITLEMENT_PLAN_NOT_FOUND` | org 无订阅（需先 E6 激活） |

---

## 四、E7：LLM 凭证明文（runtime 启动注入）

派发 runtime 前调用，取明文 api_key 注入 `OPENAI_API_KEY` 环境变量。

### 请求

```
GET /v1/entitlement/llm-config/:orgId
```

### 响应（200）

```json
{
  "org_id": "00000000-0000-4000-8000-00000000e001",
  "base_url": "http://212.129.240.112:4200",
  "api_key": "sk-7cb9efb16e5042be0fcfc8149b11efe116265d30bedafefe",
  "key_prefix": "sk-7cb9ef",
  "source": "plan_builtin"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `base_url` | string | LLM 网关地址（OpenAI 兼容，到根路径，自动补 `/v1`） |
| `api_key` | string | 明文 API key（**仅 HMAC 通道可取，勿落日志**） |
| `key_prefix` | string | key 前缀（掩码展示） |
| `source` | string | `plan_builtin`（套餐内置）/ `byok`（用户自配 user_llm_configs） |

### 解析优先级

1. **BYOK 优先**：查 `user_llm_configs` 表，有 → 返 `source:"byok"`
2. **plan 内置 fallback**：BYOK 无 → 查订阅 plan 三列（`llm_base_url`/`llm_api_key_enc`/`llm_key_prefix`），有 → 返 `source:"plan_builtin"`
3. 两处都无 → 404 `LLM_CONFIG_MISSING`

> 联调期：`beta-free` 套餐内置 OneLLM 平台 token（`http://212.129.240.112:4200` + `sk-7cb9ef...`），test org `e001` 调用必返 200 `source:"plan_builtin"`。

### Console runtime 注入示例

```javascript
const cfg = await hmacGet(`/v1/entitlement/llm-config/${orgId}`);
if (cfg.status === 200) {
  // base_url 自动补 /v1（llm-proxy 内部已处理，Console 注入 env 时也需补）
  const baseUrl = cfg.body.base_url.replace(/\/+$/, '');
  const openaiBaseUrl = /\/v\d+$/.test(baseUrl) ? baseUrl : `${baseUrl}/v1`;
  runtime.env = {
    OPENAI_BASE_URL: openaiBaseUrl,
    OPENAI_API_KEY: cfg.body.api_key,
    LLM_PROXY_MODE: cfg.body.source === 'plan_builtin' ? 'plan-builtin' : 'byok-global',
  };
}
```

### 错误

| HTTP | error_code | 场景 |
|---|---|---|
| 400 | `INVALID_ARGUMENT` | orgId 非 UUID |
| 404 | `LLM_CONFIG_MISSING` | BYOK 与 plan 内置均无（未激活订阅或 plan 无内置配置） |
| 502 | `LLM_CONFIG_DECRYPT_FAILED` | 密钥轮换过渡期解密失败（可重试） |

---

## 五、E2：模型目录 + runtime profile

创建智能体页调用，决定可选模型与 runtime profile。

### 请求

```
GET /v1/entitlement/catalogs/:orgId
GET /v1/entitlement/catalog?org_id=<orgId>   # query 别名
```

### 响应（200）

```json
{
  "models": [
    { "id": "gpt-5.4", "tier": "standard", "model_type": "chat", "flagship": false },
    { "id": "gpt-5.5", "tier": "flagship", "model_type": "chat", "flagship": true }
  ],
  "runtime_profiles": ["*"],
  "max_cloud_runtime_instances": 2
}
```

| 字段 | 说明 |
|---|---|
| `models[].tier` | `lite` / `standard` / `flagship` |
| `models[].model_type` | `chat` / `image` / `video` / `audio` / `tts` / `music` |
| `runtime_profiles` | `["*"]` = 通配，可部署所有 profile |
| `max_cloud_runtime_instances` | 云端 runtime 实例上限（-1 = 无限） |

---

## 六、E3：实时额度

Pre-dispatch 与计费面板调用，**不可缓存**（必须实时查询）。

### 请求

```
GET /v1/entitlement/quotas/:orgId
GET /v1/entitlement/quota?org_id=<orgId>   # query 别名
```

### 响应（200）

```json
{
  "exhausted": false,
  "remaining_tokens": 980000,
  "total_tokens": "500000",
  "used_tokens": "20000",
  "period_start": "2026-09-09T06:44:36.899Z",
  "period_end": "2026-10-09T06:44:36.899Z",
  "remaining_credits": 180,
  "total_credits": "200",
  "used_credits": "20",
  "frozen_credits": 5,
  "available_credits": 175,
  "free_quota": {
    "active": true,
    "remaining": 1000000,
    "remaining_credits": 200,
    "valid_until": "2026-10-09T06:44:36.899Z"
  }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `exhausted` | bool | token 是否耗尽（dispatch 前硬断） |
| `remaining_tokens` | number | 剩余 tokens（-1 = 无限） |
| `total_tokens`/`used_tokens` | string | 周期总量/已用（PG bigint 返字符串，Console 需 `Number()`） |
| `frozen_credits` | number | 媒体生成预扣费冻结中 |
| `available_credits` | number | 可用 = remaining - frozen |
| `free_quota` | object | 免费额度子对象（独立于付费额度） |

> **类型混用**：`remaining_tokens` 是 number，`total_tokens`/`used_tokens` 是 string（PG bigint 口径）。Console 读取时统一 `Number(field)`。

---

## 七、E4：用量账单（workspace 归集键 + 增量游标）

对账 job 每 5 分钟增量拉取。

### 请求

```
GET /v1/entitlement/workspaces/:workspaceId/usage?period_start=<ISO>&period_end=<ISO>&cursor=<id>&limit=<n>
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `workspaceId` | 是 | workspace UUID（path） |
| `period_start` | 是 | ISO 8601，账期开始 |
| `period_end` | 是 | ISO 8601，账期结束 |
| `cursor` | 否 | 上次末行 id（增量续拉，自 cursor 起 `WHERE id > cursor`） |
| `limit` | 否 | 默认 500 |

### 响应（200）

```json
{
  "period": { "start": "2026-09-09T00:00:00Z", "end": "2026-09-10T00:00:00Z" },
  "requests": 0,
  "input_tokens": 0,
  "output_tokens": 0,
  "credits": 0,
  "cost_cents": 0,
  "cursor": "0",
  "items": []
}
```

| 字段 | 说明 |
|---|---|
| `cursor` | 末行 id（下次请求传入）；无记录时 = "0" 或上次 cursor |
| `items[]` | 用量记录数组（agent_run_id / model / input_tokens / output_tokens / total_tokens / cost_cents） |
| `cost_cents` | CNY 整数分累计 |

### 增量续拉逻辑

```javascript
let cursor;
while (true) {
  const q = `?period_start=${start}&period_end=${end}${cursor ? `&cursor=${cursor}` : ''}&limit=500`;
  const r = await hmacGet(`/v1/entitlement/workspaces/${wsId}/usage${q}`);
  if (r.body.items.length === 0) break;
  // 处理 items...
  cursor = r.body.cursor;
  if (r.body.items.length < 500) break;
}
```

### 错误

| HTTP | error_code | 场景 |
|---|---|---|
| 400 | `INVALID_ARGUMENT` | workspaceId 非 UUID / period_start/end 缺失或非法（**2026-09-09 修复，此前为 500**） |
| 200 | — | 空态返 200 `{requests:0, items:[], cursor:"0"}`（非 404） |

> **客户端对齐**：使用权威新形态（path `workspaceId` + `period_start`/`period_end`/`cursor`/`limit`）。旧 `from`/`to` 形态已废弃。

---

## 八、L1/L2/L3：LLM 调用（Marketplace 代理转发）

Console **无需自行调上游 LLM**，走 Marketplace 侧 `llm-proxy` 代理，请求头注入 workspace key 即可。

| 端点 | 方法 | 路径 | 头 |
|---|---|---|---|
| L1 聊天 | POST | `/v1/chat/completions` | `X-Workspace-Key` + `X-Agent-Run-Id` |
| L2 向量化 | POST | `/v1/embeddings` | `X-Workspace-Key` |
| L3 模型目录 | GET | `/v1/models` | `X-Workspace-Key` |

> workspace key 由 K1 `POST /v1/gateway/keys` 签发（`sk-csi-` 前缀）。L1-L3 内部走 E7 同款 fallback（BYOK → plan 内置），Console 透明。

---

## 九、错误处理（RFC 7807）

所有错误统一 RFC 7807 problem+json：

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

**客户端错误映射按 `error_code` 字段工作**（非 `code`/`message`）。

### 常见错误码

| error_code | HTTP | 场景 | 可重试 |
|---|---|---|---|
| `INVALID_ARGUMENT` | 400 | orgId/workspaceId 非 UUID，period 缺参 | 否 |
| `AUTH_TOKEN_INVALID` | 401 | Bearer 不匹配 | 否 |
| `AUTH_HMAC_SIGNATURE_MISMATCH` | 401 | HMAC 签名错 | 否 |
| `AUTH_TIMESTAMP_EXPIRED` | 401 | ts 偏差 > 5min | 否 |
| `ENTITLEMENT_PLAN_NOT_FOUND` | 404 | org 无订阅 | 否（需 E6 激活） |
| `LLM_CONFIG_MISSING` | 404 (E7) / 409 (L1-L3) | BYOK 与 plan 内置均无 | 否 |
| `LLM_CONFIG_DECRYPT_FAILED` | 502 | 密钥轮换过渡期 | **是** |
| `ENTITLEMENT_QUOTA_EXHAUSTED` | 402 | 额度耗尽 | 否 |
| `LLM_UPSTREAM_ERROR` | 502 | 上游网关超时/不可达 | **是** |

---

## 十、联调期测试值

| 项 | 值 |
|---|---|
| base URL | `http://122.51.51.177:4001` |
| HMAC token | 联调窗口线下交换（`LONGTASK_INBOUND_TOKEN`） |
| test org（含套餐） | `00000000-0000-4000-8000-00000000e001` |
| test org（无套餐） | `00000000-0000-4000-8000-00000000e002` |
| plan_code | `beta-free`（env `ENTITLEMENT_DEFAULT_PLAN` 驱动） |
| plan 内置 LLM | `base_url=http://212.129.240.112:4200` / `api_key=sk-7cb9ef...` |

### 预期冒烟结果

| 端点 | test org e001 | test org e002 / 全零 org |
|---|---|---|
| E1 plans | 200（含 `llm_config.source:"plan_builtin"`） | 404 `ENTITLEMENT_PLAN_NOT_FOUND` |
| E7 llm-config | 200 `source:"plan_builtin"` | 404 `LLM_CONFIG_MISSING` |
| E2 catalogs | 200（模型目录） | 404 |
| E3 quotas | 200（额度对象） | 404 |
| E4 usage | 200（空态 `{requests:0}`） | 400（workspaceId 非 UUID）/ 200（合法 UUID 空态） |

---

## 十一、对接清单

Console 侧需实现：

- [ ] HMAC 签名工具（`sign(payload, ts)` = `HMAC-SHA256(payload+ts, secret).hex()`）
- [ ] nonce 生成器（`crypto.randomUUID()`，每请求新值）
- [ ] E1 调用 + `llm_config` 解析（`/settings/billing` 页）
- [ ] E7 调用 + runtime env 注入（派发前）
- [ ] E2 调用 + 模型目录渲染（创建智能体页）
- [ ] E3 调用 + 额度展示 + Pre-dispatch 硬断
- [ ] E4 对账 job（增量游标续拉，每 5min）
- [ ] 错误映射（按 `error_code` 字段）
- [ ] bigint 字段 `Number()` 转换（`total_tokens`/`used_tokens`）

---

## 附：相关代码定位

| 端点 | 实现文件 |
|---|---|
| E1-E7 | `backend/src/entitlement/entitlement.controller.ts` |
| resolveLlmConfig | `backend/src/entitlement/entitlement.service.ts:101-142` |
| EntitlementPlan（含 LLM 三列） | `backend/src/entitlement/entitlement-plan.entity.ts` |
| L1-L3 forward | `backend/src/llm-proxy/llm-proxy.service.ts` |
| HmacGuard | `backend/src/longtask/contract/hmac.guard.ts` |
| 签名算法 | `backend/src/longtask/contract/hmac-sign.ts` |
| RFC 7807 过滤器 | `backend/src/longtask/contract/rfc7807.filter.ts` |
