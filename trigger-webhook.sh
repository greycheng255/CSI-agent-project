#!/bin/bash

# Genesis Agent Webhook 触发脚本
# 用于手动触发已支付订单的 order.paid webhook

set -e

# 配置
GENESIS_API="http://122.51.51.177:30080"
ADMIN_PHONE="13800000001"
ADMIN_PASSWORD="123456"
ORDER_ID="82e4af4d-0f4b-423b-9071-fcc3f82f90b7"

echo "==================================="
echo "Genesis Webhook 触发脚本"
echo "==================================="
echo ""

# 步骤 1: 登录获取 Token
echo "[1/3] 正在登录获取 Token..."
LOGIN_RESPONSE=$(curl -s -X POST "${GENESIS_API}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"phone\": \"${ADMIN_PHONE}\",
    \"password\": \"${ADMIN_PASSWORD}\"
  }")

# 提取 Token
ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

if [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ 登录失败，无法获取 Token"
  echo "响应: $LOGIN_RESPONSE"
  exit 1
fi

echo "✅ 登录成功，获取到 Token"
echo ""

# 步骤 2: 触发 Webhook
echo "[2/3] 正在触发订单 ${ORDER_ID} 的 webhook..."
TRIGGER_RESPONSE=$(curl -s -X POST "${GENESIS_API}/api/v1/webhooks/orders/${ORDER_ID}/trigger-paid" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json")

echo "响应: $TRIGGER_RESPONSE"
echo ""

# 检查响应
if echo "$TRIGGER_RESPONSE" | grep -q '"success":true'; then
  echo "✅ Webhook 触发成功"
else
  echo "❌ Webhook 触发失败"
  exit 1
fi

echo ""
echo "[3/3] 监控命令（在新终端执行）:"
echo "-----------------------------------"
echo "# 监控 Agent 日志:"
echo "sudo kubectl logs -n genesis -l app=genesis-agent -f | grep -E 'webhook|order.paid|EXEC-FLOW|EXEC-TRACKER'"
echo ""
echo "# 监控执行进度:"
echo "PGPASSWORD=password_pd8rFh psql -h 122.51.51.177 -p 15435 -U user_BrGttd -d genesis_db -c \"SELECT name, status, progress FROM execution_phases WHERE order_id = '${ORDER_ID}' ORDER BY created_at;\""
echo ""
echo "# 监控 Webhook 记录:"
echo "PGPASSWORD=password_pd8rFh psql -h 122.51.51.177 -p 15435 -U user_BrGttd -d genesis_db -c \"SELECT payload->>'event' as event, status, created_at FROM webhook_deliveries ORDER BY created_at DESC LIMIT 5;\""
echo ""
echo "==================================="
echo "完成！请使用上述命令监控执行过程。"
echo "==================================="
