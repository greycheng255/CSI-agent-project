#!/bin/bash

# Genesis Agent 完整流程监控脚本

echo "==================================="
echo "Genesis Agent 流程监控"
echo "==================================="
echo ""

# 配置
ORDER_ID="${1:-}"

echo "监控命令:"
echo "-----------------------------------"
echo ""

if [ -n "$ORDER_ID" ]; then
  echo "# 查看指定订单的执行进度:"
  echo "PGPASSWORD=password_pd8rFh psql -h 122.51.51.177 -p 15435 -U user_BrGttd -d genesis_db -c \"SELECT name, status, progress FROM execution_phases WHERE order_id = '${ORDER_ID}' ORDER BY created_at;\""
  echo ""
fi

echo "# 实时查看 Agent 日志:"
echo "sudo kubectl logs -n genesis -l app=genesis-agent -f | grep -E 'webhook|order.paid|EXEC-FLOW|EXEC-TRACKER|扫描|报价'"
echo ""

echo "# 实时查看后端日志:"
echo "sudo kubectl logs -n genesis -l app=genesis-backend -f | grep -i webhook"
echo ""

echo "# 查看最新的 webhook 记录:"
echo "PGPASSWORD=password_pd8rFh psql -h 122.51.51.177 -p 15435 -U user_BrGttd -d genesis_db -c \"SELECT payload->>'event' as event, status, created_at FROM webhook_deliveries ORDER BY created_at DESC LIMIT 5;\""
echo ""

echo "# 查看最新的执行进度:"
echo "PGPASSWORD=password_pd8rFh psql -h 122.51.51.177 -p 15435 -U user_BrGttd -d genesis_db -c \"SELECT order_id, name, status, progress FROM execution_phases ORDER BY created_at DESC LIMIT 10;\""
echo ""

echo "==================================="
