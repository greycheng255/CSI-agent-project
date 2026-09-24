# Console ↔ Marketplace org 绑定对接指南（O1/O2）

| 项 | 值 |
|---|---|
| 状态 | Marketplace 侧已上线（2026-09-23，镜像 `genesis-backend:20260923-130327`），待 Console 侧接入 |
| 背景 | 统一账户体系（账号注册自动分配 org）公测不建；Console 新用户建 workspace 后本地 `csi_org_bindings` 无记录，开通报 `workspace has no csi org binding` |
| 权威源 | Marketplace 侧 `csi_org_bindings` 表（genesis_db）。Console 侧同名表降级为本地缓存/投影 |
| 过渡兜底 | 宿主机 cron 巡检脚本（每分钟）已自动补绑 + 激活 beta-free；Console 接入后删除该 crontab 即收尾 |

## 1. 端点契约

### O1：workspace → org 幂等解析（核心，Console 必接）

```
POST /v1/orgs/resolve
Content-Type: application/json

{"workspace_id": "<uuid>"}
```

响应（HTTP 200/201，语义相同）：

```json
{"workspace_id": "<uuid>", "org_id": "<uuid>", "created": true}
```

- 已绑定 → 返回既有 `org_id`（`created: false`）
- 未绑定 → 生成新 org 落库并返回（`created: true`）
- **幂等可重试**；并发同 workspace 重复调用返回同一 `org_id`
- `workspace_id` 非 UUID → 400 `INVALID_ARGUMENT`

### O2：绑定查询（排查用，可选）

```
GET /v1/orgs/bindings/<workspace_uuid>
→ {"workspace_id":"...","org_id":"...","source":"api|backfill","resolved_at":"..."}
无绑定 → 404 NOT_FOUND_ORG_BINDING（业务态，非错误）
```

## 2. 鉴权（与 /v1/entitlement/* 完全同构，无新增凭证）

服务级 HMAC 四件套：

```
Authorization: Bearer <LONGTASK_INBOUND_TOKEN>
X-Signature: t=<unix_ts>,v1=<hex hmac_sha256(body + ts, LONGTASK_INBOUND_SECRET)>
X-Request-Id: <唯一值>
```

- GET 请求 body 记空串参与签名
- 复用 Console 现有 entitlement 调用的签名实现即可，零新代码量

## 3. Console 侧调用时机（按序任一即可，推荐 ①+③ 兜底）

1. **创建 workspace 成功后**（最佳：后续任何入口都不再缺绑定）
2. 注册流程完成时（若注册即建 workspace）
3. **开通/创建 RuntimeInstance 解析 org 失败时的兜底重试**（消灭存量报错路径）

拿到 `org_id` 后写入本地 `csi_org_bindings`（`source='api'`），后续沿用现有逻辑。

## 4. curl 示例

```bash
BODY='{"workspace_id":"c5c32443-d65b-4135-bbd1-ff2b69d5caad"}'
TS=$(date +%s)
SIG="t=${TS},v1=$(printf '%s%s' "$BODY" "$TS" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/.*= //')"
curl -s -X POST http://172.17.0.14:4001/v1/orgs/resolve \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -H "X-Signature: ${SIG}" -H "X-Request-Id: console-$(date +%s%N)" \
  -d "$BODY"
```

## 5. 验收标准

1. 新注册用户建 workspace 后，Console 本地 `csi_org_bindings` 在秒级出现记录（`source='api'`），Marketplace 权威表同步出现
2. 同一 workspace 多次 resolve 返回同一 `org_id`
3. 「开通」全流程不再出现 `workspace has no csi org binding`
4. 回归：已有绑定 workspace（gery/solforge/pubtest 等 5 条）行为不变

## 6. 下线与收尾

Console 接入并验证后：删除宿主机 crontab 中的 `org-binding-sync.sh` 行（脚本位于
`CSI-agent-project/scripts/org-binding-sync.sh`，注释中已标注本说明）。
