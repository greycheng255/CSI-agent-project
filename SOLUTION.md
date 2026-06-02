# Genesis Agent 执行进度问题解决方案

## 问题概述

任务"抖音爬虫8"进度卡在 52%，Agent 没有收到执行通知。

## 根本原因

1. **后端 Bug**: webhook 查询逻辑错误，使用 User ID 直接查 Agent ID，导致找不到 Agent
2. **配置问题**: `AUTO_EXECUTION_ENABLED` 默认为 false，不自动发送 webhook
3. **历史订单**: 修复前已支付的订单没有触发 webhook

## 已完成的修复

### 1. 修复后端 Webhook 查询逻辑

**文件**: `/home/ubuntu/CSI-agent-project/backend/src/webhooks/webhooks.service.ts`

**修改内容**:
```typescript
// 修改前
const agent = await this.agentRepo.findOne({
  where: { id: order.owner.id },  // ❌ 错误：用 User ID 查 Agent ID
});

// 修改后
const agent = await this.agentRepo.findOne({
  where: { owner: { id: order.owner.id } },  // ✅ 正确：通过 owner 关系查询
});
```

### 2. 启用自动执行

```bash
kubectl set env deployment/genesis-backend AUTO_EXECUTION_ENABLED=true -n genesis
```

### 3. 添加手动触发 Webhook API

**文件**: `/home/ubuntu/CSI-agent-project/backend/src/webhooks/webhooks.controller.ts`

**API 端点**: `POST /api/v1/webhooks/orders/{orderId}/trigger-paid`

## 当前系统状态

| 组件 | 版本 | 状态 |
|------|------|------|
| 后端 | v1.0.26 | ✅ 运行中 |
| Agent | v1.3.3 | ✅ 运行中 |
| AUTO_EXECUTION | true | ✅ 已启用 |

## 解决方案选项

### 方案一：手动触发当前订单（推荐立即测试）

适用于已支付但未执行的订单（如"抖音爬虫8"）。

#### 步骤 1: 获取管理员 Token

```bash
# 登录获取 Token
curl -X POST http://122.51.51.177:30080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "13800000001",
    "password": "123456"
  }'
```

响应示例：
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": { ... }
}
```

#### 步骤 2: 触发 Webhook

```bash
# 使用获取的 Token 触发订单执行
curl -X POST http://122.51.51.177:30080/api/v1/webhooks/orders/82e4af4d-0f4b-423b-9071-fcc3f82f90b7/trigger-paid \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -H "Content-Type: application/json"
```

预期响应：
```json
{
  "success": true,
  "message": "Webhook order.paid triggered for order 82e4af4d-0f4b-423b-9071-fcc3f82f90b7",
  "orderId": "82e4af4d-0f4b-423b-9071-fcc3f82f90b7",
  "status": "IN_PROGRESS"
}
```

#### 步骤 3: 监控执行过程

**终端 1 - 监控 Agent 日志**:
```bash
sudo kubectl logs -n genesis -l app=genesis-agent -f | grep -E "webhook|order.paid|EXEC-FLOW|EXEC-TRACKER"
```

**终端 2 - 监控 Webhook 发送记录**:
```bash
watch -n 2 'PGPASSWORD=password_pd8rFh psql -h 122.51.51.177 -p 15435 -U user_BrGttd -d genesis_db -c "SELECT payload->>'"'"'event'"'"' as event, status, created_at FROM webhook_deliveries ORDER BY created_at DESC LIMIT 5;"'
```

**终端 3 - 监控执行进度**:
```bash
watch -n 2 'PGPASSWORD=password_pd8rFh psql -h 122.51.51.177 -p 15435 -U user_BrGttd -d genesis_db -c "SELECT name, status, progress, updated_at FROM execution_phases WHERE order_id = '"'"'82e4af4d-0f4b-423b-9071-fcc3f82f90b7'"'"' ORDER BY created_at;"'
```

### 方案二：创建新任务测试完整流程

适用于验证修复后的完整流程。

#### 完整流程验证步骤

1. **雇主创建任务**
   - 登录平台（雇主账号）
   - 发布新任务
   - 填写任务详情

2. **Agent 自动报价**
   - Agent 扫描到新任务
   - 自动分析并生成报价
   - 提交报价

3. **雇主选标**
   - 查看报价列表
   - 选择合适的报价
   - 确认选标

4. **雇主支付**
   - 进入支付页面
   - 完成支付
   - **关键点**: 支付成功后应自动触发 webhook

5. **Agent 自动执行**
   - 收到 `order.paid` webhook
   - 创建执行计划
   - 调用 Openclaw 执行
   - 上报进度

6. **验收交付**
   - 查看执行结果
   - 验收交付物
   - 释放资金

#### 监控命令

```bash
# 查看 Agent 是否收到 webhook
sudo kubectl logs -n genesis -l app=genesis-agent -f | grep -E "webhook|order.paid|EXEC-FLOW"

# 查看后端日志
sudo kubectl logs -n genesis -l app=genesis-backend -f | grep -i webhook

# 查看数据库中的 webhook 记录
PGPASSWORD=password_pd8rFh psql -h 122.51.51.177 -p 15435 -U user_BrGttd -d genesis_db -c "
SELECT 
  payload->>'event' as event,
  status,
  attempts,
  created_at
FROM webhook_deliveries 
ORDER BY created_at DESC 
LIMIT 10;
"

# 查看执行进度
PGPASSWORD=password_pd8rFh psql -h 122.51.51.177 -p 15435 -U user_BrGttd -d genesis_db -c "
SELECT 
  order_id,
  name,
  status,
  progress,
  created_at
FROM execution_phases 
ORDER BY created_at DESC 
LIMIT 10;
"
```

## 预期行为

### 正常执行流程

```
雇主支付订单
    ↓
后端发送 order.paid webhook
    ↓
Agent 收到 webhook
    ↓
Agent 调用 executeOrder()
    ↓
创建执行计划 (execution_phases)
    ↓
开始第一阶段：需求分析
    ↓
调用 Openclaw 执行任务
    ↓
Openclaw 实际执行爬虫代码
    ↓
Openclaw 上报进度到后端
    ↓
Agent 提交交付物
    ↓
雇主验收
    ↓
释放资金
```

### 进度更新机制

1. **阶段进度**: 每个阶段有多个子任务，完成子任务时更新阶段进度
2. **实时上报**: Openclaw Bridge 实时上报执行进度
3. **数据库存储**: 进度存储在 `execution_phases` 和 `execution_traces` 表中

## 故障排查

### 如果 Agent 没有收到 Webhook

1. 检查 Agent 是否在线
   ```bash
   PGPASSWORD=password_pd8rFh psql -h 122.51.51.177 -p 15435 -U user_BrGttd -d genesis_db -c "SELECT id, name, status, webhook_url FROM agents;"
   ```

2. 检查 webhook 发送记录
   ```bash
   PGPASSWORD=password_pd8rFh psql -h 122.51.51.177 -p 15435 -U user_BrGttd -d genesis_db -c "SELECT event_type, status, attempts, last_error FROM webhook_deliveries ORDER BY created_at DESC LIMIT 5;"
   ```

3. 检查后端日志
   ```bash
   sudo kubectl logs -n genesis -l app=genesis-backend --tail=50 | grep -i webhook
   ```

### 如果执行计划没有创建

1. 检查 Agent 日志中的 `[EXEC-FLOW]` 和 `[EXEC-TRACKER]` 日志
2. 检查 Agent 是否能连接到后端 API
3. 检查订单状态是否为 `IN_PROGRESS`

### 如果进度没有更新

1. 检查 `execution_traces` 表是否有新记录
2. 检查 Openclaw Bridge 是否正常运行
3. 检查 Agent 是否有上报进度的权限

## 数据库查询参考

### 查看任务详情
```sql
SELECT 
  t.id as task_id,
  t.title,
  t.status as task_status,
  o.id as order_id,
  o.status as order_status,
  o.amount_cny,
  a.name as agent_name
FROM tasks t
LEFT JOIN orders o ON o.task_id = t.id
LEFT JOIN agents a ON o.owner_user_id = a.owner_user_id
WHERE t.title LIKE '%抖音爬虫8%';
```

### 查看执行进度详情
```sql
SELECT 
  ep.name,
  ep.status,
  ep.progress,
  ep.created_at,
  ep.updated_at,
  COUNT(est.id) as subtask_count
FROM execution_phases ep
LEFT JOIN execution_sub_tasks est ON est.phase_id = ep.id
WHERE ep.order_id = '82e4af4d-0f4b-423b-9071-fcc3f82f90b7'
GROUP BY ep.id
ORDER BY ep.created_at;
```

### 查看执行时间线
```sql
SELECT 
  event,
  message,
  progress,
  reported_by,
  created_at
FROM execution_traces
WHERE order_id = '82e4af4d-0f4b-423b-9071-fcc3f82f90b7'
ORDER BY created_at;
```

## 联系支持

如果以上方案无法解决问题，请检查：
1. Kubernetes 集群状态
2. 后端和 Agent 的日志
3. 数据库连接状态
