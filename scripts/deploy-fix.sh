#!/bin/bash
# 部署脚本：K 线修复 + E 族端点上线 + DB 残留清理
# 在主机 122.51.51.177 上执行（node 直接绑 0.0.0.0:4001，无需 socat）
set -e

PROJECT_DIR="${PROJECT_DIR:-/home/ubuntu/csi-agent-project-new/CSI-agent-project}"
ENV_FILE="${ENV_FILE:-${PROJECT_DIR}/.env}"
TOKEN=$(grep '^LONGTASK_INBOUND_TOKEN=' "$ENV_FILE" | cut -d= -f2 | tr -d '[:space:]')
ORG_WITH_PLAN="00000000-0000-4000-8000-00000000e001"  # §6.4 约定 UUID 测试值

echo "=== 1. 拉取最新代码 ==="
cd "$PROJECT_DIR"
git pull origin main

echo "=== 2. 重新构建 dist ==="
cd backend
npm run build

echo "=== 3. 验证编译产物 ==="
grep -l "GatewayApiKey" dist/gateway/gateway-key.entity.js && echo "✅ GatewayApiKey 在 dist 中"
grep -l "llm-config\|llmConfig" dist/entitlement/entitlement.controller.js && echo "✅ E7 在 dist 中"
grep -l "keys.*validate\|keys.*revoke\|keys.*rotate" dist/gateway/gateway-keys.controller.js && echo "✅ K1-K4 在 dist 中"
grep -l "GatewayBridgeController" dist/gateway/gateway-bridge.controller.js && echo "✅ L1-L3 桥接在 dist 中"

echo "=== 4. 重启 4001 服务 ==="
# 停掉旧进程
pkill -f "node.*dist/main" 2>/dev/null || true
sleep 1
# node 直接绑 0.0.0.0:4001（公网可达前提：腾讯云安全组放行 4001）
PORT=4001 nohup node --enable-source-maps dist/main > /tmp/backend-4001.log 2>&1 &
echo "等待服务就绪..."
sleep 5
curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:4001/v1/entitlement/capabilities
echo ""

echo "=== 5. DB 残留清理 ==="
export PGPASSWORD="${DB_PASSWORD:-WHcWmDaySF3NXjtf}"
DBH="${DB_HOST:-122.51.51.177}"; DBP="${DB_PORT:-15435}"; DBU="${DB_USER:-genesis_db}"; DBN="${DB_NAME:-genesis_db}"
psql -h "$DBH" -p "$DBP" -U "$DBU" -d "$DBN" << 'SQL'
DELETE FROM marketplace_revision_negotiations WHERE id = '033b4135-b1a3-4ddc-9215-59db87ff17fc';
DELETE FROM marketplace_bids WHERE id::text LIKE 'dd8730b0-%';
-- M 侧冒烟探针残留：假 org …d104 经 E6 真实激活 beta-free 订阅（有效期至 2026-10-09），M 侧无权撤销，由我方清理
DELETE FROM entitlement_free_grants WHERE org_id = '00000000-0000-0000-0000-00000000d104';
DELETE FROM org_subscriptions WHERE org_id = '00000000-0000-0000-0000-00000000d104';
SELECT count(*) AS remaining_negotiations FROM marketplace_revision_negotiations WHERE id = '033b4135-b1a3-4ddc-9215-59db87ff17fc';
SELECT count(*) AS remaining_bids FROM marketplace_bids WHERE id::text LIKE 'dd8730b0-%';
SELECT count(*) AS remaining_d104_subscriptions FROM org_subscriptions WHERE org_id = '00000000-0000-0000-0000-00000000d104';
SQL

echo "=== 5.5 预置 L 族 AI Token（test org，BYOK）==="
# L1-L3 端到端需要 test org 的 user_llm_configs 行；用与 app 同口径 AES-256-GCM 加密。
# 真值由联调窗口线下注入：LLM_BASE_URL + LLM_API_KEY（OneLLM 方案二或自有网关方案一）。
if [ -n "${LLM_API_KEY}" ]; then
  LLM_BASE_URL="${LLM_BASE_URL:-https://onellm.opennotebook.chat/v1}"
  KEY_PREFIX="${LLM_API_KEY:0:8}"
  ENC_BLOB=$(cd "$PROJECT_DIR/backend" && node -e "
const crypto=require('crypto');
const secret=process.env.LONGTASK_INBOUND_TOKEN||process.env.LONGTASK_SERVICE_TOKEN||'csi-gateway-dev';
const key=crypto.createHash('sha256').update(secret+'|gateway-key-enc').digest();
const iv=crypto.randomBytes(12);
const c=crypto.createCipheriv('aes-256-gcm',key,iv);
const enc=Buffer.concat([c.update(process.env.LLM_API_KEY,'utf8'),c.final()]);
process.stdout.write(Buffer.concat([iv,c.getAuthTag(),enc]).toString('base64'));
  ")
  psql -h "$DBH" -p "$DBP" -U "$DBU" -d "$DBN" <<SQL
INSERT INTO user_llm_configs (org_id, base_url, api_key_enc, key_prefix, created_at, updated_at)
VALUES ('${ORG_WITH_PLAN}', '${LLM_BASE_URL}', '${ENC_BLOB}', '${KEY_PREFIX}', now(), now())
ON CONFLICT (org_id) DO UPDATE SET base_url=EXCLUDED.base_url, api_key_enc=EXCLUDED.api_key_enc, key_prefix=EXCLUDED.key_prefix, updated_at=now();
SELECT org_id, base_url, key_prefix, updated_at FROM user_llm_configs WHERE org_id='${ORG_WITH_PLAN}';
SQL
  echo "✅ L 族 AI Token 已预置（key_prefix=${KEY_PREFIX}…）"
else
  echo "⚠️  LLM_API_KEY 未设置，跳过 L 族 AI Token 预置（L1-L3 端到端需先注入：LLM_API_KEY=sk-... LLM_BASE_URL=... bash scripts/deploy-fix.sh）"
fi

echo "=== 5.6 激活 test org 免费套餐（D1-D6 前置）==="
sign() {
  local body="$1"; local ts=$(date +%s)
  printf 't=%s,v1=%s' "$ts" "$(printf '%s%s' "$body" "$ts" | openssl dgst -sha256 -hmac "$TOKEN" -hex | sed 's/.*= //')"
}
ACT_BODY='{"action":"activate","org_id":"'${ORG_WITH_PLAN}'","plan_code":"free"}'
curl -s -X POST http://localhost:4001/v1/entitlement/subscriptions \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -H "X-Signature: $(sign "$ACT_BODY")" -H "X-Request-Id: deploy-act-$(date +%s%N)" \
  -d "$ACT_BODY" -w "\nHTTP %{http_code}\n" || echo "(activation 跳过 — 可能已激活)"

echo "=== 6. 冒烟验证 ==="
# sign() 已在 5.6 定义；此处复用

# K1 签发
echo "--- K1 POST /v1/gateway/keys ---"
BODY="{\"org_id\":\"${ORG_WITH_PLAN}\",\"workspace_id\":\"$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)\"}"
curl -s -X POST http://localhost:4001/v1/gateway/keys \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "X-Signature: $(sign "$BODY")" \
  -H "X-Request-Id: deploy-$(date +%s%N)" \
  -d "$BODY" \
  -w "\nHTTP %{http_code}\n"

# E1 套餐
echo "--- E1 GET /v1/entitlement/plans/:orgId ---"
curl -s http://localhost:4001/v1/entitlement/plans/${ORG_WITH_PLAN} \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "X-Signature: $(sign '')" \
  -H "X-Request-Id: deploy-$(date +%s%N)" \
  -w "\nHTTP %{http_code}\n"

# E7 LLM config（不存在 org → 404）
echo "--- E7 GET /v1/entitlement/llm-config/:orgId ---"
curl -s http://localhost:4001/v1/entitlement/llm-config/00000000-0000-0000-0000-000000000000 \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "X-Signature: $(sign '')" \
  -H "X-Request-Id: deploy-$(date +%s%N)" \
  -w "\nHTTP %{http_code}\n"

echo "=== 7. 全量契约验证（post-deploy-verify.sh）==="
# 跑完整 K/E/L/S15/D1-D3 + DB 残留确认；ENV_FILE 沿用本脚本头部
ENV_FILE="${ENV_FILE:-${PROJECT_DIR}/.env}" bash "$PROJECT_DIR/scripts/post-deploy-verify.sh" || echo "⚠️  全量验证有失败项，见上行明细"

echo ""
echo "=== E4 修复专项验证（缺参 → 400 INVALID_ARGUMENT，此前为 500）==="
E4_WS=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
E4_RESP=$(curl -s -w "\n__HTTP__%{http_code}" http://localhost:4001/v1/entitlement/workspaces/${E4_WS}/usage \
  -H "Authorization: Bearer ${TOKEN}" -H "X-Signature: $(sign '')" -H "X-Request-Id: e4-$(date +%s%N)")
echo "$E4_RESP"
E4_CODE=$(echo "$E4_RESP" | tail -1 | sed 's/.*__HTTP__//')
if [ "$E4_CODE" = "400" ]; then echo "✅ E4 修复生效（400 INVALID_ARGUMENT）"; else echo "❌ E4 仍异常 → HTTP ${E4_CODE}"; fi

echo "=== 完成 ==="
