#!/bin/bash

# ==============================================================================
# Openclaw to Genesis Network - Auto Registration Script
# 
# 描述: 
#   此脚本用于在 Openclaw 的 Kubernetes Pod 或容器启动时，
#   自动向 Genesis 商业网络（CSI-agent-project）注册当前节点。
# 
# 使用方法:
#   在 Openclaw 的 Dockerfile 或 k8s entrypoint/initContainer 中执行:
#   ./register-openclaw.sh <GENESIS_API_URL> <OWNER_ID> [WEBHOOK_PORT] [SKILLS]
# 
# 示例:
#   ./register-openclaw.sh "http://192.168.1.100:4000" "d2e5cf23-4494-..." 8080
# ==============================================================================

set -e

# --- 1. 参数解析 ---
GENESIS_API_URL=${1:-"http://localhost:4000"}
OWNER_ID=$2
WEBHOOK_PORT=${3:-8080}
SKILLS=${4:-""}

if [ -z "$OWNER_ID" ]; then
  echo "❌ 错误: 必须提供 OWNER_ID (您的开发者账户 ID)"
  echo "用法: $0 <GENESIS_API_URL> <OWNER_ID> [WEBHOOK_PORT]"
  exit 1
fi

# --- 2. 获取当前节点信息 ---
# 获取 Pod 名称 (如果不在 k8s 里，则降级使用 hostname)
NODE_NAME=${HOSTNAME:-"openclaw-node-$(date +%s)"}

# 获取当前容器的内网 IP (简单适配多种 Linux 发行版)
NODE_IP=$(hostname -i | awk '{print $1}')
if [ -z "$NODE_IP" ]; then
    NODE_IP="127.0.0.1"
fi

WEBHOOK_URL="http://${NODE_IP}:${WEBHOOK_PORT}/genesis-webhook"
DESCRIPTION="Openclaw Node ($NODE_NAME) auto-registered via script"

echo "🤖 准备将当前 Openclaw 节点注册至 Genesis 网络..."
echo "  - 节点名称: $NODE_NAME"
echo "  - 节点 IP : $NODE_IP"
echo "  - Webhook : $WEBHOOK_URL"
echo "  - Skills  : ${SKILLS:-<empty>}"
echo "  - 归属账户: $OWNER_ID"
echo "  - 目标网络: $GENESIS_API_URL"
echo "----------------------------------------------------"

# --- 3. 构造 JSON Payload ---
if [ -n "$SKILLS" ]; then
  SKILLS_JSON=$(printf '%s' "$SKILLS" | awk -v RS=',' 'NF { gsub(/^[ \t]+|[ \t]+$/, "", $0); if (length($0)>0) print $0 }' | awk '{printf "\"%s\",", $0}' | sed 's/,$//')
  PAYLOAD=$(cat <<EOF
{
  "ownerId": "$OWNER_ID",
  "name": "$NODE_NAME",
  "description": "$DESCRIPTION",
  "webhookUrl": "$WEBHOOK_URL",
  "skills": [$SKILLS_JSON]
}
EOF
)
else
  PAYLOAD=$(cat <<EOF
{
  "ownerId": "$OWNER_ID",
  "name": "$NODE_NAME",
  "description": "$DESCRIPTION",
  "webhookUrl": "$WEBHOOK_URL"
}
EOF
)
fi

# --- 4. 发起注册请求 ---
echo "⏳ 正在发起注册请求..."
HTTP_RESPONSE=$(curl --silent --write-out "HTTPSTATUS:%{http_code}" -X POST "${GENESIS_API_URL}/api/v1/owner/agents" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

# 提取 Body 和 Status Code
HTTP_BODY=$(echo $HTTP_RESPONSE | sed -e 's/HTTPSTATUS\:.*//g')
HTTP_STATUS=$(echo $HTTP_RESPONSE | tr -d '\n' | sed -e 's/.*HTTPSTATUS://')

if [ "$HTTP_STATUS" -eq 201 ] || [ "$HTTP_STATUS" -eq 200 ]; then
  echo "✅ 注册成功！"
  echo "返回数据: $HTTP_BODY"
else
  echo "❌ 注册失败 (HTTP $HTTP_STATUS)"
  echo "错误信息: $HTTP_BODY"
  exit 1
fi
