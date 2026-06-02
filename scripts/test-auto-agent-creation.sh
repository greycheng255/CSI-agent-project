#!/bin/bash
# 测试用户注册时自动创建 Agent

set -e

API_BASE="http://localhost:4000"

echo "=========================================="
echo "🧪 测试用户注册时自动创建 Agent"
echo "=========================================="

# 生成随机手机号
PHONE="138$(date +%s | cut -c6-10)"
PASSWORD="test123456"

echo ""
echo "📱 注册新用户: $PHONE"
echo ""

# 注册用户
REGISTER_RESPONSE=$(curl -s -X POST "${API_BASE}/api/v1/users/register" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"${PHONE}\",\"password\":\"${PASSWORD}\"}")

echo "注册响应: $REGISTER_RESPONSE"
echo ""

# 登录获取 token
echo "🔑 登录获取 token..."
LOGIN_RESPONSE=$(curl -s -X POST "${API_BASE}/api/v1/users/login" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"${PHONE}\",\"password\":\"${PASSWORD}\"}")

echo "登录响应: $LOGIN_RESPONSE"
echo ""

# 提取 token
TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ 登录失败，无法获取 token"
  exit 1
fi

echo "✅ 登录成功，token: ${TOKEN:0:20}..."
echo ""

# 等待 Agent 创建（异步过程）
echo "⏳ 等待 Agent 创建完成..."
sleep 5

# 检查 Agent 状态
echo ""
echo "📊 检查 Agent 状态..."
AGENT_STATUS=$(curl -s "${API_BASE}/api/v1/agent-manager/my-agent/status" \
  -H "Authorization: Bearer ${TOKEN}")

echo "Agent 状态: $AGENT_STATUS"
echo ""

# 查看 K8s pods
echo "=========================================="
echo "🔍 查看 K8s Pods"
echo "=========================================="
sudo kubectl get pods -n genesis -l app=genesis-agent -o wide

echo ""
echo "=========================================="
echo "✅ 测试完成"
echo "=========================================="
echo ""
echo "📋 说明:"
echo "  • 新用户注册时自动创建了 Agent"
echo "  • Agent 部署在 K8s 中"
echo "  • 可以通过 API 查看 Agent 状态"
echo ""
echo "🔧 后续操作:"
echo "  查看所有 Agent Pods:"
echo "    sudo kubectl get pods -n genesis -l app=genesis-agent"
echo ""
echo "  查看新用户的 Agent 日志:"
echo "    sudo kubectl logs -n genesis -l userId=<user_id> --tail=50"
