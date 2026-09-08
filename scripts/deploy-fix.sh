#!/bin/bash
# 部署脚本：K 线修复 + E 族端点上线 + DB 残留清理
# 在联调实例 172.17.0.14 上执行
set -e

echo "=== 1. 拉取最新代码 ==="
cd /path/to/CSI-agent-project
git pull origin main

echo "=== 2. 重新构建 dist ==="
cd backend
npm install -D @nestjs/cli
npm run build

echo "=== 3. 验证编译产物 ==="
grep -l "GatewayApiKey" dist/gateway/gateway-key.entity.js && echo "✅ GatewayApiKey 在 dist 中"
grep -l "llm-config\|llmConfig" dist/entitlement/entitlement.controller.js && echo "✅ E7 在 dist 中"
grep -l "keys.*validate\|keys.*revoke\|keys.*rotate" dist/gateway/gateway-keys.controller.js && echo "✅ K1-K4 在 dist 中"

echo "=== 4. 重启服务 ==="
# 如果用 docker-compose:
# docker-compose -f ../docker-images/docker-compose.yml up -d --build genesis-backend
# 如果直接 pm2:
pm2 restart genesis-backend
# 如果直接 node:
# kill $(lsof -t -i:4001) && PORT=4001 node dist/main.js &

echo "=== 5. 等待服务就绪 ==="
sleep 5
curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:4001/v1/entitlement/plans/test
echo ""

echo "=== 6. DB 残留清理 ==="
PGPASSWORD=genesis_password psql -h localhost -p 5432 -U genesis_user -d genesis_db << 'SQL'
-- 清理 negotiation 033b4135（假 order 创建的悬挂记录）
DELETE FROM marketplace_revision_negotiations WHERE id = '033b4135-b1a3-4ddc-9215-59db87ff17cf';
-- 清理 bid dd8730b0（探针占席）
DELETE FROM marketplace_bids WHERE id::text LIKE 'dd8730b0-%';
-- 确认无残留
SELECT count(*) AS remaining_negotiations FROM marketplace_revision_negotiations WHERE id = '033b4135-b1a3-4ddc-9215-59db87ff17cf';
SELECT count(*) AS remaining_bids FROM marketplace_bids WHERE id::text LIKE 'dd8730b0-%';
SQL

echo "=== 7. 冒烟验证 ==="
# K1 签发
echo "--- K1 POST /v1/gateway/keys ---"
curl -s -X POST http://localhost:4001/v1/gateway/keys \
  -H "Authorization: Bearer test-inbound-token" \
  -H "Content-Type: application/json" \
  -H "X-Signature: t=$(date +%s),v1=test" \
  -H "X-Request-Id: $(uuidgen)" \
  -d '{"org_id":"test-org","workspace_id":"test-ws"}' \
  -w "\nHTTP %{http_code}\n"

# E1 套餐
echo "--- E1 GET /v1/entitlement/plans/:orgId ---"
curl -s http://localhost:4001/v1/entitlement/plans/test-org \
  -H "Authorization: Bearer test-inbound-token" \
  -H "X-Signature: t=$(date +%s),v1=test" \
  -H "X-Request-Id: $(uuidgen)" \
  -w "\nHTTP %{http_code}\n"

# E7 LLM config
echo "--- E7 GET /v1/entitlement/llm-config/:orgId ---"
curl -s http://localhost:4001/v1/entitlement/llm-config/nonexistent-org \
  -H "Authorization: Bearer test-inbound-token" \
  -H "X-Signature: t=$(date +%s),v1=test" \
  -H "X-Request-Id: $(uuidgen)" \
  -w "\nHTTP %{http_code}\n"

echo "=== 完成 ==="
