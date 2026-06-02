# Genesis Kubernetes 部署指南

## 文件结构

```
k8s/
├── namespace.yaml           # 命名空间
├── backend-deployment.yaml  # 后端 Deployment 和 PVC
├── frontend-deployment.yaml # 前端 Deployment
├── services.yaml            # Service 配置
├── kustomization.yaml       # Kustomize 配置
└── README.md               # 本文件
```

## 快速部署

### 1. 构建镜像

```bash
# 构建后端镜像
cd backend
docker build -t genesis-backend:latest .

# 构建前端镜像
cd ../frontend
docker build -t genesis-frontend:latest .
```

### 2. 部署到 Kubernetes

```bash
# 使用 kubectl 直接部署
cd k8s
kubectl apply -f namespace.yaml
kubectl apply -f backend-deployment.yaml
kubectl apply -f frontend-deployment.yaml
kubectl apply -f services.yaml

# 或使用 kustomize
kubectl apply -k .
```

### 3. 查看部署状态

```bash
# 查看 Pod 状态
kubectl get pods -n genesis

# 查看 Service
kubectl get svc -n genesis

# 查看日志
kubectl logs -n genesis -l app=genesis-backend
kubectl logs -n genesis -l app=genesis-frontend
```

### 4. 访问应用

- **前端**: http://<NodeIP>:30080
- **后端 API**: http://<NodeIP>:30080/api/v1

## 配置说明

### 后端配置

- **数据库**: PostgreSQL (外部数据库 122.51.51.177:15435)
- **端口**: 4000
- **资源限制**: 256Mi-512Mi 内存, 250m-500m CPU

### 前端配置

- **Web 服务器**: Nginx
- **端口**: 80
- **资源限制**: 64Mi-128Mi 内存, 100m-200m CPU
- **API 代理**: 自动代理到后端 Service

### 服务配置

- **后端 Service**: ClusterIP (内部访问)
- **前端 Service**: NodePort:30080 (外部访问)

## 扩展部署

### 水平扩展后端

```bash
kubectl scale deployment genesis-backend --replicas=3 -n genesis
```

### 更新镜像

```bash
# 修改 kustomization.yaml 中的镜像标签
# 然后重新部署
kubectl apply -k .
```

### 清理部署

```bash
kubectl delete namespace genesis
```
