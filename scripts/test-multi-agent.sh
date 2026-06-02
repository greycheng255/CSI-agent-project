#!/bin/bash
# 测试多用户独立 Agent 场景

set -e

echo "=========================================="
echo "🧪 测试多用户独立 Agent 部署"
echo "=========================================="

# 模拟两个不同的用户
USER_A="0967d32f-5af3-4917-8fd2-346eb4b7751c"
USER_B="test-user-b-$(date +%s)"

OWNER_TOKEN_A="BjE_PwKyOCr6KvPMcdO9Qw7lLYLJuqC_RY0iWj7eVo8"
OWNER_TOKEN_B="test-token-b-$(openssl rand -hex 16)"

echo ""
echo "👤 用户 A: ${USER_A:0:8}..."
echo "👤 用户 B: ${USER_B:0:8}..."

# 创建脚本目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "=========================================="
echo "🚀 为用户 A 创建 Agent (Openclaw grey)"
echo "=========================================="
"${SCRIPT_DIR}/create-user-agent.sh" "$USER_A" "$OWNER_TOKEN_A" "grey" || true

echo ""
echo "=========================================="
echo "🚀 为用户 B 创建 Agent (Openclaw linbo)"
echo "=========================================="
# 修改模板使用 linbo 实例
export OPENCLAW_INSTANCE="linbo"
"${SCRIPT_DIR}/create-user-agent.sh" "$USER_B" "$OWNER_TOKEN_B" "linbo" || true

echo ""
echo "=========================================="
echo "📊 查看所有 Agent Pod"
echo "=========================================="
sleep 5
kubectl get pods -n genesis -l app=genesis-agent -o wide

echo ""
echo "=========================================="
echo "🔗 查看 Agent Services"
echo "=========================================="
kubectl get services -n genesis -l app=genesis-agent

echo ""
echo "=========================================="
echo "📝 查看 Pod 日志 (用户 A)"
echo "=========================================="
kubectl logs -n genesis -l userId="$USER_A" --tail=20 || echo "Pod 可能还在启动中..."

echo ""
echo "=========================================="
echo "📝 查看 Pod 日志 (用户 B)"
echo "=========================================="
kubectl logs -n genesis -l userId="$USER_B" --tail=20 || echo "Pod 可能还在启动中..."

echo ""
echo "=========================================="
echo "✅ 测试完成"
echo "=========================================="
echo ""
echo "📋 架构说明:"
echo "  • 用户 A 的 Agent → Openclaw grey"
echo "  • 用户 B 的 Agent → Openclaw linbo"
echo "  • 每个用户有独立的 Pod 和 Service"
echo "  • 故障隔离，互不影响"
echo ""
echo "🔧 管理命令:"
echo "  查看所有 Agent Pods:"
echo "    kubectl get pods -n genesis -l app=genesis-agent"
echo ""
echo "  查看特定用户的 Agent:"
echo "    kubectl get pods -n genesis -l userId=${USER_A:0:8}"
echo ""
echo "  删除用户 A 的 Agent:"
echo "    kubectl delete deployment genesis-agent-${USER_A} -n genesis"
echo "    kubectl delete service genesis-agent-${USER_A} -n genesis"
