#!/bin/bash

# Genesis 简单 Pod 部署脚本
# 使用 hostPath 挂载代码目录，无需构建镜像

set -e

echo "🚀 Genesis 简单 Pod 部署"
echo "========================"

# 创建命名空间
kubectl apply -f namespace.yaml

# 部署 Pod
kubectl apply -f genesis-pod.yaml

# 部署 Service
kubectl apply -f services.yaml

echo ""
echo "⏳ 等待 Pod 启动..."
sleep 5

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
echo ""
echo "查看日志:"
echo "  kubectl logs -n genesis genesis-backend"
echo "  kubectl logs -n genesis genesis-frontend"
echo ""
