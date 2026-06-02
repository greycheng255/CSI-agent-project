import { Task, TaskAnalysis, Bid, Order } from '../types';
import { GenesisClient } from './genesis-client';
import { SkillsManager } from './skills-manager';
import { TaskQualityAssessor } from './task-quality-assessor';
import { SmartPricingEngine } from './smart-pricing-engine';
import { LearningEngine } from './learning-engine';
import { AgentMonitor } from './agent-monitor';
import { getLogger } from '../utils/logger';
import axios from 'axios';

const logger = getLogger();
const OPENCLAW_BRIDGE_URL = process.env.OPENCLAW_BRIDGE_URL || 'http://openclaw-bridge.openclaw-cloud.svc.cluster.local:8080';

/**
 * 自动化配置
 */
export interface AutoPipelineConfig {
  // 任务筛选
  minQualityScore: number;           // 最低质量分数
  minProfitMargin: number;           // 最低利润率
  maxRiskLevel: 'low' | 'medium' | 'high';  // 最高风险等级
  
  // 定价策略
  pricingStrategy: 'aggressive' | 'balanced' | 'conservative';
  autoAdjustPrice: boolean;          // 是否自动调价
  
  // 执行策略
  autoExecute: boolean;              // 是否自动执行
  maxConcurrentExecutions: number;   // 最大并发执行数
  
  // 交付策略
  autoSubmitDelivery: boolean;       // 是否自动提交交付物
  deliveryReviewThreshold: number;   // 交付物审核阈值
  
  // 异常处理
  autoRetry: boolean;                // 是否自动重试
  maxRetries: number;                // 最大重试次数
  
  // 学习优化
  autoOptimize: boolean;             // 是否自动优化策略
  optimizationInterval: number;      // 优化间隔（小时）
}

/**
 * 流水线状态
 */
export interface PipelineState {
  taskId: string;
  status: 'scanning' | 'assessing' | 'pricing' | 'bidding' | 'waiting' | 'executing' | 'delivering' | 'completed' | 'failed';
  currentStage: string;
  progress: number;
  startTime: number;
  lastUpdate: number;
  metadata: Record<string, any>;
}

/**
 * 全自动任务流水线
 * 实现从任务发现到交付的全程自动化
 */
export class AutoPipeline {
  private genesisClient: GenesisClient;
  private skillsManager: SkillsManager;
  private qualityAssessor: TaskQualityAssessor;
  private pricingEngine: SmartPricingEngine;
  private learningEngine: LearningEngine;
  private monitor: AgentMonitor;
  private config: AutoPipelineConfig;
  
  private activePipelines: Map<string, PipelineState> = new Map();
  private executingOrders: Set<string> = new Set();
  private agentId: string;
  private webhookUrl: string;

  constructor(
    genesisClient: GenesisClient,
    skillsManager: SkillsManager,
    qualityAssessor: TaskQualityAssessor,
    pricingEngine: SmartPricingEngine,
    learningEngine: LearningEngine,
    monitor: AgentMonitor,
    agentId: string,
    webhookUrl: string,
    config: Partial<AutoPipelineConfig> = {}
  ) {
    this.genesisClient = genesisClient;
    this.skillsManager = skillsManager;
    this.qualityAssessor = qualityAssessor;
    this.pricingEngine = pricingEngine;
    this.learningEngine = learningEngine;
    this.monitor = monitor;
    this.agentId = agentId;
    this.webhookUrl = webhookUrl;
    
    this.config = {
      minQualityScore: 0.3,
      minProfitMargin: 0.25,
      maxRiskLevel: 'medium',
      pricingStrategy: 'balanced',
      autoAdjustPrice: true,
      autoExecute: true,
      maxConcurrentExecutions: 3,
      autoSubmitDelivery: true,
      deliveryReviewThreshold: 0.8,
      autoRetry: true,
      maxRetries: 3,
      autoOptimize: true,
      optimizationInterval: 24,
      ...config
    };
  }

  /**
   * 处理新任务 - 全自动流程入口
   */
  async processTask(task: Task, analysis: TaskAnalysis): Promise<void> {
    const pipelineId = `pipeline-${task.id}`;
    
    // 检查是否已在处理中
    if (this.activePipelines.has(pipelineId)) {
      logger.info('Task already in pipeline', { taskId: task.id });
      return;
    }

    // 初始化流水线状态
    const state: PipelineState = {
      taskId: task.id,
      status: 'scanning',
      currentStage: '初始化',
      progress: 0,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      metadata: { task, analysis }
    };
    
    this.activePipelines.set(pipelineId, state);
    
    try {
      // 阶段 1: 质量评估
      await this.stageQualityAssessment(state);
      
      // 阶段 2: 智能定价
      await this.stagePricing(state);
      
      // 阶段 3: 自动报价
      await this.stageBidding(state);
      
      // 阶段 4: 等待中标（异步）
      await this.stageWaiting(state);
      
    } catch (error) {
      logger.error('Pipeline failed', { taskId: task.id, error });
      state.status = 'failed';
      state.currentStage = '失败';
      this.updatePipelineState(state);
    }
  }

  /**
   * 阶段 1: 质量评估
   */
  private async stageQualityAssessment(state: PipelineState): Promise<void> {
    state.status = 'assessing';
    state.currentStage = '质量评估';
    state.progress = 10;
    this.updatePipelineState(state);

    const { task, analysis } = state.metadata;
    const estimatedCost = analysis.timeEstimate * 50;

    // 执行质量评估
    const assessment = await this.qualityAssessor.assessTaskQuality(
      task,
      analysis,
      estimatedCost
    );

    // 自动决策
    const shouldProceed = this.autoDecideTaskAcceptance(assessment);
    
    if (!shouldProceed) {
      logger.info('Task auto-rejected', {
        taskId: task.id,
        score: assessment.score,
        reasons: assessment.reasons
      });
      throw new Error('Task rejected by auto-assessment');
    }

    // 记录学习数据
    const record = this.learningEngine.recordExecution(
      task,
      analysis,
      assessment,
      { basePrice: estimatedCost, marketAdjustment: 0, finalPrice: 0, competitorCount: 0 }
    );

    state.metadata.assessment = assessment;
    state.metadata.learningRecordId = record.id;
    state.progress = 25;
    this.updatePipelineState(state);

    logger.info('Quality assessment completed', {
      taskId: task.id,
      score: assessment.score,
      decision: 'accept'
    });
  }

  /**
   * 自动决策是否接受任务
   */
  private autoDecideTaskAcceptance(assessment: any): boolean {
    // 检查质量分数
    if (assessment.score < this.config.minQualityScore) {
      return false;
    }

    // 检查利润率
    const profitMargin = assessment.expectedProfit / (assessment.expectedProfit + assessment.expectedProfit / assessment.score);
    if (profitMargin < this.config.minProfitMargin) {
      return false;
    }

    // 检查风险等级
    const riskLevels: Record<string, number> = { low: 0, medium: 1, high: 2 };
    const assessmentRisk = assessment.riskLevel ? riskLevels[assessment.riskLevel] : 0;
    const configRisk = riskLevels[this.config.maxRiskLevel] ?? 1;
    if (assessmentRisk > configRisk) {
      return false;
    }

    return true;
  }

  /**
   * 阶段 2: 智能定价
   */
  private async stagePricing(state: PipelineState): Promise<void> {
    state.status = 'pricing';
    state.currentStage = '智能定价';
    state.progress = 30;
    this.updatePipelineState(state);

    const { task, analysis } = state.metadata;

    // 计算最优价格
    const pricingResult = await this.pricingEngine.calculateOptimalPrice(
      task,
      analysis,
      analysis.timeEstimate,
      task.clientUserId
    );

    // 更新学习记录
    if (state.metadata.learningRecordId) {
      this.learningEngine.updateExecutionResult(state.metadata.learningRecordId, {
        pricingStrategy: {
          basePrice: pricingResult.breakdown.basePrice,
          marketAdjustment: pricingResult.breakdown.marketAdjustment,
          finalPrice: pricingResult.optimalPrice,
          competitorCount: pricingResult.marketAnalysis.competitorCount
        }
      });
    }

    state.metadata.pricingResult = pricingResult;
    state.progress = 40;
    this.updatePipelineState(state);

    logger.info('Pricing completed', {
      taskId: task.id,
      optimalPrice: pricingResult.optimalPrice,
      confidence: pricingResult.confidence
    });
  }

  /**
   * 阶段 3: 自动报价
   */
  private async stageBidding(state: PipelineState): Promise<void> {
    state.status = 'bidding';
    state.currentStage = '提交报价';
    state.progress = 50;
    this.updatePipelineState(state);

    const { task, analysis, pricingResult } = state.metadata;

    // 调用 Openclaw 获取分析结果
    const openclawResult = await this.callOpenclawAnalyze(task, analysis);

    // 提交报价
    const bid = await this.submitBid(task, openclawResult, pricingResult.optimalPrice);

    if (!bid) {
      throw new Error('Failed to submit bid');
    }

    state.metadata.bid = bid;
    state.progress = 60;
    this.updatePipelineState(state);

    // 更新学习记录
    if (state.metadata.learningRecordId) {
      this.learningEngine.updateExecutionResult(state.metadata.learningRecordId, {
        bidAccepted: false
      });
    }

    logger.info('Bid submitted', {
      taskId: task.id,
      bidId: bid.id,
      price: bid.priceCny
    });
  }

  /**
   * 阶段 4: 等待中标
   */
  private async stageWaiting(state: PipelineState): Promise<void> {
    state.status = 'waiting';
    state.currentStage = '等待中标';
    state.progress = 70;
    this.updatePipelineState(state);

    // 这里不需要阻塞等待，Webhook 会处理中标事件
    logger.info('Waiting for bid acceptance', { taskId: state.taskId });
  }

  /**
   * 处理中标事件 - 自动执行
   */
  async handleBidAccepted(order: Order, bid: Bid): Promise<void> {
    const taskId = order.task?.id || order.taskId;
    const pipelineId = `pipeline-${taskId}`;
    
    const state = this.activePipelines.get(pipelineId);
    if (!state) {
      logger.warn('Pipeline not found for order', { orderId: order.id, taskId });
      return;
    }

    // 检查并发限制
    if (this.executingOrders.size >= this.config.maxConcurrentExecutions) {
      logger.warn('Max concurrent executions reached, queuing order', { orderId: order.id });
      // 可以加入队列稍后执行
      return;
    }

    this.executingOrders.add(order.id);
    state.metadata.order = order;
    
    try {
      // 阶段 5: 自动执行
      await this.stageExecution(state, order);
      
      // 阶段 6: 自动交付
      if (this.config.autoSubmitDelivery) {
        await this.stageDelivery(state, order);
      }
      
      state.status = 'completed';
      state.currentStage = '完成';
      state.progress = 100;
      
      // 更新学习记录
      if (state.metadata.learningRecordId) {
        this.learningEngine.updateExecutionResult(state.metadata.learningRecordId, {
          bidAccepted: true,
          orderCompleted: true,
          actualPrice: order.amountCny
        });
      }
      
    } catch (error) {
      logger.error('Execution failed', { orderId: order.id, error });
      state.status = 'failed';
      state.currentStage = '执行失败';
      
      // 自动重试
      if (this.config.autoRetry && state.metadata.retryCount < this.config.maxRetries) {
        state.metadata.retryCount = (state.metadata.retryCount || 0) + 1;
        logger.info('Auto-retrying execution', { orderId: order.id, attempt: state.metadata.retryCount });
        await this.stageExecution(state, order);
      }
    } finally {
      this.executingOrders.delete(order.id);
      this.updatePipelineState(state);
    }
  }

  /**
   * 阶段 5: 自动执行
   */
  private async stageExecution(state: PipelineState, order: Order): Promise<void> {
    state.status = 'executing';
    state.currentStage = '执行订单';
    state.progress = 80;
    this.updatePipelineState(state);

    const task = state.metadata.task;
    const bid = state.metadata.bid;

    // 调用 Openclaw 执行
    const executionResult = await this.callOpenclawExecute({
      orderId: order.id,
      taskId: task.id,
      title: task.title,
      description: task.description || '',
      bidPrice: order.amountCny,
      executionPlan: bid.pricingMeta?.evaluation?.executionPlan || [],
      acceptanceCriteria: task.acceptanceCriteria
    });

    if (!executionResult.success) {
      throw new Error(`Execution failed: ${executionResult.error}`);
    }

    state.metadata.executionResult = executionResult;
    state.progress = 90;
    this.updatePipelineState(state);

    logger.info('Execution completed', { orderId: order.id });
  }

  /**
   * 阶段 6: 自动交付
   */
  private async stageDelivery(state: PipelineState, order: Order): Promise<void> {
    state.status = 'delivering';
    state.currentStage = '提交交付物';
    state.progress = 95;
    this.updatePipelineState(state);

    const executionResult = state.metadata.executionResult;
    
    // 自动生成交付内容
    const deliveryContent = this.generateDeliveryContent(executionResult);
    
    // 提交交付物 - 需要 userId
    const userId = order.ownerUserId || order.ownerId || '';
    await this.genesisClient.submitDelivery(order.id, userId, {
      deliverySummary: deliveryContent,
      deliveryUrl: ''
    });

    logger.info('Delivery submitted', { orderId: order.id });
  }

  /**
   * 调用 Openclaw 分析
   */
  private async callOpenclawAnalyze(task: Task, analysis: TaskAnalysis): Promise<any> {
    const response = await axios.post(
      `${OPENCLAW_BRIDGE_URL}/api/v1/analyze`,
      {
        taskId: task.id,
        title: task.title,
        description: task.description,
        budget: task.budgetCny,
        tags: task.tags || [],
        acceptanceCriteria: task.acceptanceCriteria,
        expectedDeliveryAt: task.expectedDeliveryAt,
        agentId: this.agentId,
        webhookUrl: this.webhookUrl
      },
      { timeout: 30000, headers: { 'Content-Type': 'application/json' } }
    );

    if (response.data?.success) {
      return response.data.data;
    }
    throw new Error('Openclaw analysis failed');
  }

  /**
   * 调用 Openclaw 执行
   */
  private async callOpenclawExecute(execution: any): Promise<any> {
    const response = await axios.post(
      `${OPENCLAW_BRIDGE_URL}/api/v1/execute`,
      {
        orderId: execution.orderId,
        taskId: execution.taskId,
        title: execution.title,
        description: execution.description,
        bidPrice: execution.bidPrice,
        executionPlan: execution.executionPlan,
        acceptanceCriteria: execution.acceptanceCriteria,
        agentId: this.agentId,
        webhookUrl: this.webhookUrl
      },
      { timeout: 60000, headers: { 'Content-Type': 'application/json' } }
    );

    if (response.data?.success) {
      return await this.waitForExecution(execution.orderId);
    }
    return { success: false, error: 'Execution failed' };
  }

  /**
   * 等待执行完成
   */
  private async waitForExecution(orderId: string, maxWait: number = 300000): Promise<any> {
    const startTime = Date.now();
    const pollInterval = 5000;

    while (Date.now() - startTime < maxWait) {
      try {
        const response = await axios.get(
          `${OPENCLAW_BRIDGE_URL}/api/v1/execution/${orderId}/status`,
          { timeout: 10000 }
        );

        if (response.data?.success) {
          const status = response.data.data;
          
          if (status.status === 'completed') {
            return { success: true, files: status.files, data: status.data };
          }
          
          if (status.status === 'failed') {
            return { success: false, error: status.error };
          }
        }
      } catch (error) {
        logger.warn('Failed to check execution status', { orderId, error });
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return { success: false, error: 'Execution timeout' };
  }

  /**
   * 提交报价
   */
  private async submitBid(task: Task, openclawResult: any, optimalPrice: number): Promise<Bid | null> {
    try {
      const bidData = {
        taskId: task.id,
        priceCny: optimalPrice,
        planSummary: `已解析需求「${task.title}」。复杂度${openclawResult.complexityCn}，预估${openclawResult.estimatedHours}小时。`,
        detailedPlan: openclawResult.analysis,
        pricingModel: 'smart_auto',
        pricingMeta: {
          openclawInstance: openclawResult.instanceName || 'unknown',
          skillHits: openclawResult.matchedSkills.map((s: any) => s.name),
          evaluation: {
            baseRate: 50,
            estimatedHours: openclawResult.estimatedHours,
            complexity: openclawResult.complexity,
            suggestedPrice: optimalPrice,
            executionPlan: openclawResult.executionPlan
          }
        },
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
      };

      return await this.genesisClient.submitBid(bidData);
    } catch (error) {
      logger.error('Failed to submit bid', { taskId: task.id, error });
      return null;
    }
  }

  /**
   * 生成交付内容
   */
  private generateDeliveryContent(executionResult: any): string {
    return `
## 执行结果

### 交付物清单
${executionResult.files?.map((f: string) => `- ${f}`).join('\n') || '- 数据文件'}

### 执行摘要
- 执行状态: ✅ 成功
- 生成时间: ${new Date().toLocaleString()}

### 数据样本
\`\`\`json
${JSON.stringify(executionResult.data?.slice(0, 5), null, 2)}
\`\`\`

### 使用说明
1. 下载交付物文件
2. 按照 README.md 中的说明运行
3. 如有问题请联系

---
*本交付物由 Genesis Agent 自动生成*
    `.trim();
  }

  /**
   * 更新流水线状态
   */
  private updatePipelineState(state: PipelineState): void {
    state.lastUpdate = Date.now();
    this.activePipelines.set(`pipeline-${state.taskId}`, state);
    
    // 上报监控
    this.monitor.recordBusinessMetrics({
      tasksScanned: this.activePipelines.size
    });
  }

  /**
   * 获取流水线状态
   */
  getPipelineState(taskId: string): PipelineState | undefined {
    return this.activePipelines.get(`pipeline-${taskId}`);
  }

  /**
   * 获取所有活跃流水线
   */
  getAllPipelines(): PipelineState[] {
    return Array.from(this.activePipelines.values());
  }

  /**
   * 清理完成的流水线
   */
  cleanupPipelines(maxAge: number = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [key, state] of this.activePipelines) {
      if (state.status === 'completed' || state.status === 'failed') {
        if (now - state.lastUpdate > maxAge) {
          this.activePipelines.delete(key);
        }
      }
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<AutoPipelineConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Pipeline config updated', this.config);
  }
}
