#!/bin/bash
# 部署脚本：K 线修复 + E 族端点上线 + DB 残留清理
# 在主机 122.51.51.177 上执行（node 直接绑 0.0.0.0:4001，无需 socat）
set -e

PROJECT_DIR="${PROJECT_DIR:-/home/ubuntu/csi-agent-project-new/CSI-agent-project}"
ENV_FILE="${ENV_FILE:-${PROJECT_DIR}/.env}"
TOKEN=$(grep '^LONGTASK_INBOUND_TOKEN=' "$ENV_FILE" | cut -d= -f2 | tr -d '[:space:]')
ORG_WITH_PLAN="29803cbb-10b0-49c1-ac49-1eb296cf9f36"

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
psql -h "${DB_HOST:-122.51.51.177}" -p "${DB_PORT:-15435}" -U "${DB_USER:-genesis_db}" -d "${DB_NAME:-genesis_db}" << 'SQL'
DELETE FROM marketplace_revision_negotiations WHERE id = '033b4135-b1a3-4ddc-9215-59db87ff17fc';
DELETE FROM marketplace_bids WHERE id::text LIKE 'dd8730b0-%';
SELECT count(*) AS remaining_negotiations FROM marketplace_revision_negotiations WHERE id = '033b4135-b1a3-4ddc-9215-59db87ff17fc';
SELECT count(*) AS remaining_bids FROM marketplace_bids WHERE id::text LIKE 'dd8730b0-%';
SQL

echo "=== 6. 冒烟验证 ==="
sign() {
  local body="$1"; local ts=$(date +%s)
  printf 't=%s,v1=%s' "$ts" "$(printf '%s%s' "$body" "$ts" | openssl dgst -sha256 -hmac "$TOKEN" -hex | sed 's/.*= //')"
}

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

echo "=== 完成 ==="
