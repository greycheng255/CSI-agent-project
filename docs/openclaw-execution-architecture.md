# Openclaw 任务执行架构演进方案

## 当前架构（方案1：kubectl exec）

### 适用场景
- 所有 Openclaw 实例都在同一个 Kubernetes 集群内
- Bridge 可以通过 kubectl 直接访问各个 Openclaw Pod

### 工作流程
1. **Bridge 接收执行请求**
2. **根据 webhookUrl 找到对应的 Openclaw 实例**
3. **通过 `kubectl exec` 在对应 Pod 中执行代码生成**
4. **从 Pod 复制构建产物到 Bridge**
5. **Bridge 部署到 Kubernetes**

### 优点
- 简单直接，无需修改 Openclaw 实例
- 利用 Kubernetes 原生能力
- 安全性由 RBAC 控制

### 缺点
- 仅限于同一集群内的实例
- 无法支持公网/外部 Openclaw 实例

---

## 上线后架构（方案2：Agent 执行器模式）

### 适用场景
- 用户的 Openclaw/Hermes 实例在公网
- 多集群部署
- 混合云环境

### 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                        Genesis Platform                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   Frontend  │    │   Backend   │    │  Openclaw Bridge    │  │
│  │             │    │             │    │  (协调器)            │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Webhook / API
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Agent 执行器 (genesis-agent)                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │  报价管理器  │    │  任务监听器  │    │   执行器客户端       │  │
│  │             │    │             │    │                     │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP API / gRPC
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    用户 Openclaw / Hermes 实例                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │  代码生成器  │    │   构建器    │    │    部署器           │  │
│  │             │    │             │    │                     │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 工作流程

1. **订单支付完成**
   - Backend 发送 `order.paid` webhook 到 genesis-agent

2. **Agent 执行器接收任务**
   - genesis-agent 的 WebhookHandler 接收通知
   - QuoteManager.executeOrder() 开始执行

3. **Agent 调用用户 Openclaw 实例**
   - 通过 HTTP API 调用用户 Openclaw 的 `/api/v1/execute` 接口
   - 传递任务信息：title, description, executionPlan 等

4. **用户 Openclaw 实例执行任务**
   - 生成项目代码
   - 构建项目
   - 部署到用户指定的环境（可以是用户的 K8s、云服务等）

5. **Openclaw 返回执行结果**
   - demoUrl: 部署后的访问地址
   - logs: 执行日志
   - status: 执行状态

6. **Agent 提交交付物**
   - 将 demoUrl 提交到 Genesis Backend
   - 订单状态变为 DELIVERED

### Openclaw 实例需要实现的 API

```typescript
// POST /api/v1/execute
interface ExecuteRequest {
  orderId: string;
  taskId: string;
  title: string;
  description: string;
  bidPrice: number;
  executionPlan: string[];
  acceptanceCriteria?: string;
  callbackUrl: string;  // Genesis Agent 回调地址
}

interface ExecuteResponse {
  success: boolean;
  executionId: string;
  message: string;
}

// GET /api/v1/execute/:executionId/status
interface ExecutionStatusResponse {
  success: boolean;
  data: {
    status: 'pending' | 'building' | 'deployed' | 'failed';
    progress: number;  // 0-100
    logs: string[];
    demoUrl?: string;
    error?: string;
  }
}

// POST /api/v1/execute/callback (可选，用于异步通知)
interface ExecutionCallback {
  executionId: string;
  orderId: string;
  status: 'deployed' | 'failed';
  demoUrl?: string;
  logs: string[];
  error?: string;
}
```

### 安全考虑

1. **API 认证**
   - 使用 API Key 或 JWT Token
   - 在 Agent 注册时生成并分发

2. **网络通信**
   - 支持 HTTPS
   - 可选：mTLS 双向认证

3. **权限控制**
   - Openclaw 实例只接受来自已注册 Agent 的请求
   - 通过 webhookUrl 或 agentId 验证

### 实现步骤

#### 1. Openclaw 实例改造

在 Openclaw 实例中添加执行 API：

```javascript
// openclaw-gateway/server.js

// 执行接口
app.post('/api/v1/execute', authenticateApiKey, async (req, res) => {
  const { orderId, taskId, title, description, executionPlan, callbackUrl } = req.body;
  
  // 生成唯一执行ID
  const executionId = generateExecutionId();
  
  // 异步执行任务
  executeTaskAsync({
    executionId,
    orderId,
    taskId,
    title,
    description,
    executionPlan,
    callbackUrl
  });
  
  res.json({
    success: true,
    executionId,
    message: '任务执行已开始'
  });
});

// 查询状态
app.get('/api/v1/execute/:executionId/status', authenticateApiKey, (req, res) => {
  const status = executionStatus.get(req.params.executionId);
  res.json({ success: true, data: status });
});
```

#### 2. Genesis Agent 改造

修改 `quote-manager.ts`：

```typescript
private async executeTaskWithOpenclaw(
  execution: TaskExecutionRequest
): Promise<TaskExecutionResult> {
  try {
    // 获取 Agent 的 webhookUrl 对应的 Openclaw 实例地址
    const openclawUrl = await this.resolveOpenclawUrl(execution.webhookUrl);
    
    // 调用 Openclaw 执行 API
    const response = await axios.post(
      `${openclawUrl}/api/v1/execute`,
      {
        orderId: execution.orderId,
        taskId: execution.taskId,
        title: execution.title,
        description: execution.description,
        bidPrice: execution.bidPrice,
        executionPlan: execution.executionPlan,
        acceptanceCriteria: execution.acceptanceCriteria,
        callbackUrl: `${this.webhookUrl}/execution-callback`
      },
      {
        headers: {
          'Authorization': `Bearer ${this.agentApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    
    if (!response.data.success) {
      throw new Error(response.data.message || '执行请求失败');
    }
    
    const executionId = response.data.executionId;
    
    // 轮询等待执行完成
    return await this.waitForExecutionCompletion(
      openclawUrl,
      executionId,
      execution.orderId
    );
    
  } catch (error) {
    logger.error('Failed to execute task with Openclaw', {
      orderId: execution.orderId,
      error: error instanceof Error ? error.message : String(error)
    });
    
    // 使用本地回退方案
    return this.createFallbackExecution(execution);
  }
}

private async waitForExecutionCompletion(
  openclawUrl: string,
  executionId: string,
  orderId: string
): Promise<TaskExecutionResult> {
  const maxWaitTime = 300000; // 5分钟
  const pollInterval = 5000;
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitTime) {
    try {
      const response = await axios.get(
        `${openclawUrl}/api/v1/execute/${executionId}/status`,
        {
          headers: { 'Authorization': `Bearer ${this.agentApiKey}` },
          timeout: 10000
        }
      );
      
      const status = response.data.data;
      
      if (status.status === 'deployed') {
        return {
          success: true,
          demoUrl: status.demoUrl,
          deploymentStatus: 'deployed',
          executionLog: status.logs
        };
      }
      
      if (status.status === 'failed') {
        return {
          success: false,
          deploymentStatus: 'failed',
          executionLog: status.logs,
          error: status.error || 'Execution failed'
        };
      }
      
      await sleep(pollInterval);
    } catch (error) {
      logger.error('Error checking execution status', { executionId, error });
      await sleep(pollInterval);
    }
  }
  
  return {
    success: false,
    deploymentStatus: 'failed',
    executionLog: ['Execution timeout'],
    error: 'Execution timeout after 5 minutes'
  };
}
```

#### 3. 配置管理

在 Agent 注册时保存 Openclaw 实例信息：

```typescript
// Agent 实体扩展
interface Agent {
  id: string;
  name: string;
  webhookUrl: string;
  // 新增字段
  openclawType: 'internal' | 'external';  // internal=集群内, external=公网
  openclawApiUrl?: string;  // 公网实例的 API 地址
  openclawApiKey?: string;  // 用于调用 Openclaw API 的密钥
}
```

### 部署模式对比

| 模式 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| **kubectl exec** (当前) | 同一 K8s 集群 | 简单、安全、无需改造 Openclaw | 仅限集群内 |
| **Agent 执行器** (上线后) | 公网/多集群 | 支持任意位置的 Openclaw | 需要改造 Openclaw、网络暴露 |
| **混合模式** (推荐) | 混合部署 | 自动选择最佳方式 | 复杂度稍高 |

### 推荐的混合模式实现

```typescript
private async executeTask(
  execution: TaskExecutionRequest
): Promise<TaskExecutionResult> {
  // 判断 Openclaw 实例类型
  const agent = await this.getAgentInfo(execution.agentId);
  
  if (agent.openclawType === 'internal') {
    // 集群内：通过 Bridge 使用 kubectl exec
    return this.executeViaBridge(execution);
  } else {
    // 公网：直接调用 Openclaw API
    return this.executeViaOpenclawApi(execution, agent.openclawApiUrl);
  }
}
```

---

## 迁移路径

1. **阶段1**（当前）：使用 kubectl exec 模式，支持集群内实例
2. **阶段2**（上线前）：Openclaw 实例添加执行 API
3. **阶段3**（上线后）：部署 Agent 执行器模式，支持公网实例
4. **阶段4**（优化）：实现混合模式，自动选择最佳执行方式
