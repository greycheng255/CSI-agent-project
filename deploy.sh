#!/bin/bash

# Genesis 项目部署脚本
# 用于构建镜像并部署到 Kubernetes

set -e

echo "🚀 Genesis 项目 Kubernetes 部署脚本"
echo "===================================="

# 检查 kubectl 是否安装
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl 未安装，请先安装 kubectl"
    exit 1
fi

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker"
    exit 1
fi

echo ""
echo "📦 步骤 1: 构建后端镜像"
echo "------------------------"
cd backend
docker build -t genesis-backend:latest .
cd ..

echo ""
echo "📦 步骤 2: 构建前端镜像"
echo "------------------------"
cd frontend
docker build -t genesis-frontend:latest .
cd ..

echo ""
echo "☸️  步骤 3: 部署到 Kubernetes"
echo "------------------------------"
cd k8s

# 创建命名空间
kubectl apply -f namespace.yaml

# 部署后端
kubectl apply -f backend-deployment.yaml

# 部署前端
kubectl apply -f frontend-deployment.yaml

# 部署 Service
kubectl apply -f services.yaml

cd ..

echo ""
echo "⏳ 步骤 4: 等待 Pod 启动"
echo "------------------------"
sleep 5

# 检查 Pod 状态
echo ""
echo "📊 Pod 状态:"
kubectl get pods -n genesis

echo ""
echo "📊 Service 状态:"
kubectl get svc -n genesis

echo ""
echo "✅ 部署完成!"
echo "============"
echo ""
echo "访问地址:"
echo "  前端: http://<NodeIP>:30080"
echo "  API:  http://<NodeIP>:30080/api/v1"
echo ""
echo "查看日志:"
echo "  kubectl logs -n genesis -l app=genesis-backend"
echo "  kubectl logs -n genesis -l app=genesis-frontend"
echo ""
