# 任务执行数据追踪方案

## 1. 数据流追踪点

### 1.1 Genesis-Agent → Genesis Backend

```typescript
// 任务扫描和报价阶段
class TaskScanner {
  async scanAndBid() {
    // [追踪点] 扫描到新任务
    console.log(`[TASK-FLOW] 扫描到新任务 | taskId=${task.id} | title=${task.title}`);
    
    // [追踪点] 开始分析任务
    console.log(`[TASK-FLOW] 开始分析任务 | taskId=${task.id} | step=analyze`);
    const analysis = await this.analyzeTask(task);
    
    // [追踪点] 分析完成
    console.log(`[TASK-FLOW] 任务分析完成 | taskId=${task.id} | 
      taskType=${analysis.requirements.taskType} | 
      estimatedHours=${analysis.breakdown.totalHours}`);
    
    // [追踪点] 提交报价
    console.log(`[TASK-FLOW] 提交报价 | taskId=${task.id} | price=${bid.priceCny}`);
    await this.submitBid(task.id, bid);
    
    // [追踪点] 报价成功
    console.log(`[TASK-FLOW] 报价成功 | taskId=${task.id} | bidId=${bidId}`);
  }
}
```

### 1.2 订单创建和执行阶段

```typescript
// Genesis Backend - 订单状态变更
class OrdersService {
  async createOrder(taskId: string, bidId: string) {
    // [追踪点] 订单创建
    console.log(`[ORDER-FLOW] 订单创建 | orderId=${order.id} | 
      taskId=${taskId} | bidId=${bidId} | 
      amount=${order.amountCny}`);
    
    return order;
  }
  
  async updateOrderStatus(orderId: string, status: OrderStatus) {
    const oldStatus = order.status;
    
    // [追踪点] 状态变更
    console.log(`[ORDER-FLOW] 状态变更 | orderId=${orderId} | 
      ${oldStatus} -> ${status} | 
      time=${new Date().toISOString()}`);
    
    // 验证：状态流转是否合法
    if (!this.isValidStatusTransition(oldStatus, status)) {
      console.error(`[ORDER-FLOW] 非法状态流转 | orderId=${orderId} | 
        ${oldStatus} -> ${status}`);
      throw new Error('Invalid status transition');
    }
    
    order.status = status;
    await this.save(order);
  }
}
```

### 1.3 任务执行阶段 - Openclaw-Agent

```typescript
// Openclaw-Agent 执行器
class TaskExecutor {
  async executeTask(orderId: string, executionPlan: ExecutionPlan) {
    // [追踪点] 开始执行任务
    console.log(`[EXEC-FLOW] 开始执行任务 | orderId=${orderId} | 
      phases=${executionPlan.phases.length}`);
    
    for (const phase of executionPlan.phases) {
      // [追踪点] 开始阶段
      console.log(`[EXEC-FLOW] 开始阶段 | orderId=${orderId} | 
        phase=${phase.name} | step=${phase.sequence}`);
      
      await this.executePhase(orderId, phase);
      
      // [追踪点] 阶段完成
      console.log(`[EXEC-FLOW] 阶段完成 | orderId=${orderId} | 
        phase=${phase.name} | progress=${phase.progress}%`);
    }
    
    // [追踪点] 任务执行完成
    console.log(`[EXEC-FLOW] 任务执行完成 | orderId=${orderId}`);
  }
  
  async executeSubTask(orderId: string, phaseId: string, subTask: SubTask) {
    // [追踪点] 开始子任务
    console.log(`[EXEC-FLOW] 开始子任务 | orderId=${orderId} | 
      subTask=${subTask.name} | type=${subTask.taskKey}`);
    
    try {
      const result = await this.runSubTask(subTask);
      
      // [追踪点] 子任务完成
      console.log(`[EXEC-FLOW] 子任务完成 | orderId=${orderId} | 
        subTask=${subTask.name} | success=true | 
        result=${JSON.stringify(result).substring(0, 100)}`);
      
      // 上报进度
      await this.reportProgress(orderId, phaseId, subTask.id, 100, result);
      
    } catch (error) {
      // [追踪点] 子任务失败
      console.error(`[EXEC-FLOW] 子任务失败 | orderId=${orderId} | 
        subTask=${subTask.name} | error=${error.message}`);
      
      await this.reportProgress(orderId, phaseId, subTask.id, 0, null, error.message);
      throw error;
    }
  }
}
```

### 1.4 代码生成和执行 - Openclaw-Bridge

```typescript
// Openclaw-Bridge 代码执行
class OpenclawBridge {
  async executeCodeGeneration(task: Task, requirements: any) {
    // [追踪点] 开始代码生成
    console.log(`[BRIDGE-FLOW] 开始代码生成 | taskId=${task.id} | 
      taskType=${requirements.taskType}`);
    
    // 生成代码
    const code = await this.generateCode(task, requirements);
    
    // [追踪点] 代码生成完成
    console.log(`[BRIDGE-FLOW] 代码生成完成 | taskId=${task.id} | 
      codeLength=${code.length} | 
      files=${code.files?.length || 0}`);
    
    // 执行代码
    const result = await this.executeInPod(task.id, code);
    
    // [追踪点] 代码执行完成
    console.log(`[BRIDGE-FLOW] 代码执行完成 | taskId=${task.id} | 
      success=${result.success} | 
      output=${result.output?.substring(0, 100)}`);
    
    return result;
  }
  
  async executeInPod(taskId: string, code: CodeBundle) {
    const podName = this.getPodName(taskId);
    
    // [追踪点] 开始在Pod中执行
    console.log(`[BRIDGE-FLOW] Pod执行 | taskId=${taskId} | 
      pod=${podName} | action=exec`);
    
    const result = await this.kubectlExec(podName, code);
    
    // [追踪点] Pod执行完成
    console.log(`[BRIDGE-FLOW] Pod执行完成 | taskId=${taskId} | 
      pod=${podName} | exitCode=${result.exitCode}`);
    
    return result;
  }
}
```

## 2. 数据一致性验证

### 2.1 订单状态一致性检查

```typescript
// 定时检查任务
class DataConsistencyChecker {
  async checkOrderConsistency() {
    const orders = await this.getActiveOrders();
    
    for (const order of orders) {
      // 检查1: 订单状态与执行阶段是否匹配
      const phases = await this.getExecutionPhases(order.id);
      const calculatedProgress = this.calculateProgress(phases);
      
      if (order.status === 'IN_PROGRESS' && calculatedProgress === 100) {
        console.warn(`[CONSISTENCY] 状态不匹配 | orderId=${order.id} | 
          status=IN_PROGRESS but progress=100%`);
      }
      
      // 检查2: 已完成的任务必须有交付物
      if (order.status === 'DELIVERED' && !order.deliveryUrl) {
        console.warn(`[CONSISTENCY] 缺少交付物 | orderId=${order.id} | 
          status=DELIVERED but no deliveryUrl`);
      }
      
      // 检查3: 金额计算是否正确
      const expectedPayout = order.amountCny - order.platformFeeCny;
      if (order.payoutCny !== expectedPayout) {
        console.warn(`[CONSISTENCY] 金额计算错误 | orderId=${order.id} | 
          expected=${expectedPayout} | actual=${order.payoutCny}`);
      }
    }
  }
}
```

### 2.2 进度数据验证

```typescript
// 进度上报验证
class ProgressValidator {
  validateProgressReport(report: ProgressReport) {
    // 验证1: 进度值范围
    if (report.progress < 0 || report.progress > 100) {
      throw new Error(`Invalid progress value: ${report.progress}`);
    }
    
    // 验证2: 进度只能增加不能减少
    const lastProgress = await this.getLastProgress(report.orderId, report.subTaskId);
    if (report.progress < lastProgress) {
      console.warn(`[PROGRESS] 进度回退 | orderId=${report.orderId} | 
        subTask=${report.subTaskId} | 
        ${lastProgress}% -> ${report.progress}%`);
    }
    
    // 验证3: 完成时间合理性
    if (report.progress === 100 && !report.completedAt) {
      report.completedAt = new Date();
    }
    
    return report;
  }
}
```

## 3. 关键数据快照

### 3.1 订单生命周期快照

```typescript
// 订单关键节点快照
interface OrderSnapshot {
  orderId: string;
  timestamp: string;
  status: OrderStatus;
  progress: number;
  data: {
    taskTitle: string;
    amount: number;
    payout: number;
    phases: PhaseSnapshot[];
    currentPhase?: string;
    currentSubTask?: string;
  };
}

// 在关键节点保存快照
class OrderSnapshotService {
  async saveSnapshot(orderId: string, trigger: string) {
    const order = await this.getOrder(orderId);
    const phases = await this.getExecutionPhases(orderId);
    
    const snapshot: OrderSnapshot = {
      orderId,
      timestamp: new Date().toISOString(),
      status: order.status,
      progress: this.calculateTotalProgress(phases),
      data: {
        taskTitle: order.task.title,
        amount: order.amountCny,
        payout: order.payoutCny,
        phases: phases.map(p => ({
          name: p.name,
          status: p.status,
          progress: p.progress,
          subTasks: p.subTasks.map(st => ({
            name: st.name,
            status: st.status,
            progress: st.progress,
          })),
        })),
        currentPhase: phases.find(p => p.status === 'IN_PROGRESS')?.name,
        currentSubTask: phases.flatMap(p => p.subTasks)
          .find(st => st.status === 'IN_PROGRESS')?.name,
      },
    };
    
    // 保存到数据库或日志
    console.log(`[SNAPSHOT] orderId=${orderId} | trigger=${trigger} | 
      data=${JSON.stringify(snapshot)}`);
    
    await this.saveToDatabase(snapshot);
  }
}
```

## 4. 问题诊断日志

### 4.1 慢任务检测

```typescript
// 检测执行时间过长的任务
class SlowTaskDetector {
  async detectSlowTasks() {
    const activeOrders = await this.getInProgressOrders();
    
    for (const order of activeOrders) {
      const duration = Date.now() - new Date(order.escrowedAt).getTime();
      const hours = duration / (1000 * 60 * 60);
      
      // 如果执行超过预估时间2倍，报警
      const estimatedHours = order.bid?.pricingMeta?.evaluation?.estimatedHours || 24;
      
      if (hours > estimatedHours * 2) {
        console.warn(`[SLOW-TASK] 任务执行超时 | orderId=${order.id} | 
          elapsed=${hours.toFixed(1)}h | 
          estimated=${estimatedHours}h | 
          ratio=${(hours/estimatedHours).toFixed(1)}x`);
      }
    }
  }
}
```

### 4.2 错误聚合

```typescript
// 错误日志聚合
class ErrorAggregator {
  private errorCounts: Map<string, number> = new Map();
  
  logError(category: string, error: Error, context: any) {
    const key = `${category}:${error.message}`;
    const count = (this.errorCounts.get(key) || 0) + 1;
    this.errorCounts.set(key, count);
    
    console.error(`[ERROR] category=${category} | 
      message=${error.message} | 
      count=${count} | 
      context=${JSON.stringify(context)}`);
    
    // 如果同一错误发生多次，升级报警
    if (count >= 5) {
      console.error(`[ERROR-ALERT] 错误频繁发生 | category=${category} | 
        message=${error.message} | count=${count}`);
    }
  }
}
```

## 5. 使用示例

### 5.1 查看任务执行流程

```bash
# 查看特定订单的执行日志
kubectl logs -n genesis genesis-agent-xxx | grep "orderId=xxx"

# 查看所有执行中的任务
kubectl logs -n genesis genesis-agent-xxx | grep "\[EXEC-FLOW\]"

# 查看错误日志
kubectl logs -n genesis genesis-agent-xxx | grep "\[ERROR\]"
```

### 5.2 数据一致性检查

```bash
# 运行一致性检查
kubectl exec -n genesis genesis-backend-xxx -- 
  node -e "require('./dist/consistency-checker').checkAll()"
```

## 6. 日志格式规范

所有日志统一格式：

```
[LEVEL-FLOW] 描述 | key1=value1 | key2=value2 | ...
```

示例：
```
[INFO-FLOW] 订单创建 | orderId=abc123 | taskId=task456 | amount=100
[WARN-FLOW] 状态不匹配 | orderId=abc123 | expected=DELIVERED | actual=IN_PROGRESS
[ERROR-FLOW] 子任务失败 | orderId=abc123 | subTask=http_module | error=timeout
```
