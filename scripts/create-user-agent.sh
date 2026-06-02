#!/bin/bash
# 为新用户创建独立的 Genesis Agent
# 用法: ./create-user-agent.sh <user_id> <owner_token> [openclaw_instance]

set -e

USER_ID=$1
OWNER_TOKEN=$2
OPENCLAW_INSTANCE=${3:-"grey"}

if [ -z "$USER_ID" ] || [ -z "$OWNER_TOKEN" ]; then
  echo "用法: $0 <user_id> <owner_token> [openclaw_instance]"
  echo "示例: $0 0967d32f-5af3-4917-8fd2-346eb4b7751c BjE_PwKyOCr6KvPMcdO9Qw7lLYLJuqC_RY0iWj7eVo8"
  exit 1
fi

echo "🚀 为用户 ${USER_ID} 创建 Genesis Agent..."

# 生成唯一标识
EXTERNAL_ID="genesis-agent-${USER_ID:0:8}"
AGENT_ID=$(uuidgen || cat /proc/sys/kernel/random/uuid || echo "agent-$(date +%s)")
AGENT_API_KEY=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-43)

echo "📋 配置信息:"
echo "  - User ID: ${USER_ID}"
echo "  - Agent ID: ${AGENT_ID}"
echo "  - External ID: ${EXTERNAL_ID}"
echo "  - Openclaw 实例: ${OPENCLAW_INSTANCE}"

# 设置环境变量并部署
export USER_ID
export AGENT_ID
export EXTERNAL_ID
export AGENT_API_KEY
export OWNER_TOKEN

# 检查模板文件是否存在
TEMPLATE_FILE="${PWD}/k8s/genesis-agent-template.yaml"
if [ ! -f "$TEMPLATE_FILE" ]; then
  # 尝试其他路径
  TEMPLATE_FILE="/home/ubuntu/CSI-agent-project/k8s/genesis-agent-template.yaml"
fi

if [ ! -f "$TEMPLATE_FILE" ]; then
  echo "❌ 错误: 找不到模板文件 genesis-agent-template.yaml"
  exit 1
fi

echo "📝 应用 Kubernetes 配置..."
envsubst < "$TEMPLATE_FILE" | kubectl apply -f -

echo "⏳ 等待 Agent 启动..."
kubectl rollout status deployment/genesis-agent-${USER_ID} -n genesis --timeout=120s

echo ""
echo "✅ Agent 创建成功!"
echo ""
echo "🔑 请保存以下信息:"
echo "=========================="
echo "Agent ID: ${AGENT_ID}"
echo "API Key: ${AGENT_API_KEY}"
echo "External ID: ${EXTERNAL_ID}"
echo "=========================="
echo ""
echo "📊 查看 Pod 状态:"
echo "  kubectl get pods -n genesis -l userId=${USER_ID}"
echo ""
echo "📜 查看日志:"
echo "  kubectl logs -n genesis deployment/genesis-agent-${USER_ID} --tail=50"
