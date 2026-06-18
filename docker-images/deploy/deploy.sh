#!/bin/bash
# ============================================
# Genesis 一键部署脚本 (k3s)
# 用法: sh deploy.sh
# ============================================
set -e

echo "=========================================="
echo "  Genesis 平台 K3s 部署脚本"
echo "=========================================="

# 检查 kubectl
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl 未找到，请确认 k3s 已安装"
    exit 1
fi

# 导入镜像（如果 tar 文件存在）
TAR_FILE="genesis-all_20260618-142742.tar"
if [ -f "$TAR_FILE" ]; then
    echo ""
    echo "📦 第1步: 导入镜像..."
    k3s ctr images import "$TAR_FILE"
    echo "✅ 镜像导入完成"
else
    echo "⚠️  未找到 $TAR_FILE，跳过镜像导入"
fi

echo ""
echo "📋 第2步: 创建命名空间..."
kubectl apply -f 00-namespaces.yaml

echo ""
echo "🔐 第3步: 配置 RBAC 权限..."
kubectl apply -f 01-rbac.yaml

echo ""
echo "💾 第4步: 创建存储卷..."
kubectl apply -f 02-storage.yaml

echo ""
echo "🖥️  第5步: 部署后端服务..."
kubectl apply -f 03-backend.yaml

echo ""
echo "🎨 第6步: 部署前端服务..."
kubectl apply -f 04-frontend.yaml

echo ""
echo "🔧 第7步: 部署 OpenClaw Bridge..."
kubectl apply -f 05-bridge.yaml

echo ""
echo "🤖 第8步: 部署主 Agent..."
kubectl apply -f 06-agent-main.yaml

echo ""
echo "💓 第9步: 部署心跳服务..."
kubectl apply -f 07-agent-heartbeat.yaml

echo ""
echo "⏳ 等待 Pod 启动..."
sleep 5

echo ""
echo "=========================================="
echo "  部署状态"
echo "=========================================="
echo ""
echo "📊 Pod 列表:"
kubectl get pods -n genesis
kubectl get pods -n openclaw-cloud

echo ""
echo "📊 Service 列表:"
kubectl get svc -n genesis
kubectl get svc -n openclaw-cloud

echo ""
echo "=========================================="
echo "  ✅ 部署完成！"
echo "=========================================="
echo ""
echo "  访问地址: http://<服务器IP>:30080"
echo "  API 地址: http://<服务器IP>:30080/api/v1"
echo ""
echo "  查看日志:"
echo "    kubectl logs -n genesis -l app=genesis-backend -f"
echo "    kubectl logs -n genesis -l app=genesis-frontend -f"
echo "    kubectl logs -n genesis -l app=genesis-agent -f"
echo "    kubectl logs -n openclaw-cloud -l app=openclaw-bridge -f"
echo ""
