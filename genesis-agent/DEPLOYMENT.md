# Genesis Agent 部署指南

## 修复内容总结

本次修复解决了进度显示与实际工作进度不符的问题。

### 问题原因

1. **进度上报使用了错误的 ID**: Agent 使用自定义 key（如 `phase-0`）上报进度，但后端期望的是数据库 UUID
2. **前端使用模拟数据**: 当无法获取真实进度时，前端回退到静态模拟数据

### 修复方案

1. **修改 `execution-tracker.ts`**:
   - `createExecutionPlan` 现在返回后端创建的 phase 和 subtask 的真实 ID 映射
   - 使用这些真实 ID 进行后续的进度上报

2. **修改 `quote-manager.ts`**:
   - 使用 ID 映射来上报阶段和子任务进度
   - 确保每个进度更新都使用正确的数据库 ID

3. **增强网络诊断**:
   - 启动时自动检测网络连通性
   - 提供详细的错误诊断和修复建议

## 部署步骤

### 1. 重新构建镜像

```bash
cd /home/ubuntu/CSI-agent-project/genesis-agent

# 构建新镜像
docker build -t genesis-agent:v1.3.3 .

# 或者使用版本标签
docker tag genesis-agent:v1.3.3 genesis-agent:latest
```

### 2. 更新 Kubernetes 部署

```bash
# 更新镜像版本
kubectl set image deployment/genesis-agent agent=genesis-agent:v1.3.3 -n genesis

# 或者重新应用部署文件
kubectl apply -f /home/ubuntu/CSI-agent-project/k8s/genesis-agent-deployment.yaml

# 等待滚动更新完成
kubectl rollout status deployment/genesis-agent -n genesis
```

### 3. 验证部署

```bash
# 查看 Pod 状态
kubectl get pods -n genesis -l app=genesis-agent

# 查看日志
kubectl logs -n genesis -l app=genesis-agent --tail=100 -f
```

### 4. 测试进度上报

1. 在平台上创建一个新任务
2. 等待 Agent 报价并被选中
3. 支付订单，触发任务执行
4. 观察订单详情页面的进度更新

## 验证修复效果

### 预期行为

1. **阶段进度实时更新**: 每个阶段的进度应该从 0% 逐步增加到 100%
2. **子任务进度可见**: 展开阶段可以看到各个子任务的进度
3. **状态同步**: 阶段状态（进行中/已完成）应该与实际执行一致

### 检查日志

在 Agent 日志中应该看到：

```
[EXEC-TRACKER] 执行计划创建成功 | orderId=xxx | phases=8 | mapped=8
[EXEC-TRACKER] 阶段开始 | phase=需求分析 | id=550e8400-e29b-41d4-a716-446655440000
[EXEC-TRACKER] 进度上报 | orderId=xxx | event=PROGRESS | progress=50%
[EXEC-TRACKER] 阶段完成 | phase=需求分析
```

## 故障排查

### 问题 1: 进度仍然不更新

**检查步骤**:
1. 查看 Agent 日志是否有 `[EXEC-TRACKER]` 相关的输出
2. 检查后端 API 是否返回了正确的 phase ID
3. 使用测试脚本验证 API 连通性:
   ```bash
   ./scripts/test-progress-report.sh
   ```

### 问题 2: EAI_AGAIN DNS 错误

**解决方案**:
1. 确保 Agent Pod 和后端在同一个 Kubernetes 集群
2. 检查 Service 配置:
   ```bash
   kubectl get svc -n genesis
   ```
3. 如果跨集群访问，使用 NodePort 或 Ingress

### 问题 3: 前端显示模拟数据

**检查步骤**:
1. 打开浏览器开发者工具
2. 检查 Network 标签中 `/api/v1/execution/orders/{id}/progress` 的请求
3. 确认返回的数据中有真实的 phases 数据
4. 如果 API 返回空，检查 Agent 是否正确上报了进度

## 回滚方案

如果修复出现问题，可以回滚到之前的版本：

```bash
# 回滚到上一个版本
kubectl rollout undo deployment/genesis-agent -n genesis

# 或者指定版本
kubectl set image deployment/genesis-agent agent=genesis-agent:v1.3.2 -n genesis
```

## 配置文件参考

确保 `k8s/genesis-agent-deployment.yaml` 中的环境变量正确：

```yaml
env:
  - name: GENESIS_API
    value: "http://genesis-backend.genesis.svc.cluster.local:4000"
  - name: AGENT_API_KEY
    value: "your-agent-api-key"
  - name: LOG_LEVEL
    value: "debug"  # 调试时设置为 debug
```
