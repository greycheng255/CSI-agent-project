import {
  GenesisClient,
  SkillsManager,
  TaskScanner,
  QuoteManager,
  HeartbeatService,
  WebhookHandler,
  TaskQualityAssessor,
  SmartPricingEngine,
  AgentMonitor,
  LearningEngine
} from './modules';
import { Task, TaskAnalysis, AgentConfig } from './types';
import { getLogger } from './utils/logger';

const logger = getLogger();

/**
 * 增强版 Genesis Agent
 * 集成智能任务筛选、动态定价、监控告警和自动学习功能
 */
export class EnhancedGenesisAgent {
  // 核心模块
  private genesisClient: GenesisClient;
  private skillsManager: SkillsManager;
  private taskScanner: TaskScanner;
  private quoteManager: QuoteManager;
  private heartbeatService: HeartbeatService;
  private webhookHandler: WebhookHandler;
  
  // 智能优化模块
  private qualityAssessor: TaskQualityAssessor;
  private pricingEngine: SmartPricingEngine;
  private monitor: AgentMonitor;
  private learningEngine: LearningEngine;
  
  // 配置
  private config: AgentConfig;
  private isRunning = false;
  
  // 统计
  private stats = {
    tasksScanned: 0,
    tasksAssessed: 0,
    tasksQuoted: 0,
    bidsSubmitted: 0,
    bidsAccepted: 0,
    totalRevenue: 0,
    totalProfit: 0
  };

  constructor(config: AgentConfig) {
    this.config = config;
    
    // 初始化核心模块
    this.genesisClient = new GenesisClient({
      baseUrl: config.genesisApi,
      agentId: config.agentId,
      ownerToken: config.ownerToken,
      agentApiKey: config.agentApiKey
    });
    
    this.skillsManager = new SkillsManager({
      configPath: './config/skills.yaml'
    });
    
    // 初始化智能优化模块
    this.qualityAssessor = new TaskQualityAssessor(this.genesisClient);
    this.pricingEngine = new SmartPricingEngine(this.genesisClient, {
      baseRateCny: 50,
      minProfitMargin: 0.25,
      competitiveStrategy: 'balanced'
    });
    this.monitor = new AgentMonitor(this.genesisClient, config.agentId);
    this.learningEngine = new LearningEngine('./data');
    
    // 初始化任务扫描器（使用增强版筛选）
    this.taskScanner = new TaskScanner(
      this.genesisClient,
      this.skillsManager,
      {
        intervalMs: config.scanInterval || 30000,
        batchSize: 20
      },
      this.handleMatchedTask.bind(this)
    );
    
    // 初始化报价管理器
    this.quoteManager = new QuoteManager(
      this.skillsManager,
      this.genesisClient,
      config.agentId,
      config.openclawUrl,
      config.genesisApi,
      config.agentApiKey
    );
    
    // 初始化心跳服务
    this.heartbeatService = new HeartbeatService({
      genesisClient: this.genesisClient,
      intervalMs: config.heartbeatInterval || 30000
    });
    
    // 初始化 Webhook 处理器
    this.webhookHandler = new WebhookHandler(
      this.quoteManager,
      3000
    );
    
    // 设置监控告警回调
    this.monitor.onAlert((alert, value) => {
      logger.warn(`[AGENT ALERT] ${alert.name}: ${value}`);
    });
    
    logger.info('Enhanced Genesis Agent initialized', {
      agentId: config.agentId,
      features: [
        'smart_task_filtering',
        'dynamic_pricing',
        'performance_monitoring',
        'auto_learning'
      ]
    });
  }

  /**
   * 启动 Agent
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Agent is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting Enhanced Genesis Agent...');

    try {
      // 1. 初始化技能管理器
      await this.skillsManager.initialize();
      
      // 2. 启动监控
      this.monitor.startMonitoring(60000);
      
      // 3. 启动任务扫描
      await this.taskScanner.start();
      
      // 4. 启动心跳服务
      await this.heartbeatService.start();
      
      // 5. 启动 Webhook 服务
      await this.webhookHandler.start();
      
      // 6. 定期生成学习报告
      this.startLearningReportScheduler();
      
      logger.info('Enhanced Genesis Agent started successfully');
      
      // 打印学习报告
      this.printLearningReport();
      
    } catch (error) {
      this.isRunning = false;
      logger.error('Failed to start agent', { error });
      throw error;
    }
  }

  /**
   * 停止 Agent
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    logger.info('Stopping Enhanced Genesis Agent...');

    this.taskScanner.stop();
    this.heartbeatService.stop();
    this.monitor.stopMonitoring();
    
    // 生成最终报告
    this.printLearningReport();
    
    logger.info('Enhanced Genesis Agent stopped');
  }

  /**
   * 处理匹配的任务（增强版）
   */
  private async handleMatchedTask(task: Task, analysis: TaskAnalysis): Promise<void> {
    this.stats.tasksScanned++;
    
    try {
      logger.info('Task matched, starting quality assessment', {
        taskId: task.id,
        title: task.title
      });

      // 1. 预估成本（基于 Openclaw 预估工时）
      const estimatedCost = analysis.timeEstimate * 50; // 基础费率
      
      // 2. 质量评估
      const qualityAssessment = await this.qualityAssessor.assessTaskQuality(
        task,
        analysis,
        estimatedCost
      );
      
      this.stats.tasksAssessed++;
      
      // 记录业务指标
      this.monitor.recordBusinessMetrics({
        tasksScanned: this.stats.tasksScanned,
        tasksAssessed: this.stats.tasksAssessed
      });

      // 3. 根据评估结果决策
      if (qualityAssessment.recommendation === 'reject') {
        logger.info('Task rejected by quality assessment', {
          taskId: task.id,
          score: qualityAssessment.score,
          reasons: qualityAssessment.reasons
        });
        return;
      }

      if (qualityAssessment.recommendation === 'review') {
        logger.warn('Task needs review', {
          taskId: task.id,
          score: qualityAssessment.score,
          reasons: qualityAssessment.reasons
        });
        // 可以继续处理，但记录警告
      }

      // 4. 记录执行数据（用于学习）
      const executionRecord = this.learningEngine.recordExecution(
        task,
        analysis,
        qualityAssessment,
        {
          basePrice: estimatedCost,
          marketAdjustment: 0,
          finalPrice: 0,
          competitorCount: 0
        }
      );

      // 5. 计算最优价格
      const pricingResult = await this.pricingEngine.calculateOptimalPrice(
        task,
        analysis,
        analysis.timeEstimate,
        task.clientUserId
      );

      // 更新执行记录
      this.learningEngine.updateExecutionResult(executionRecord.id, {
        pricingStrategy: {
          basePrice: pricingResult.breakdown.basePrice,
          marketAdjustment: pricingResult.breakdown.marketAdjustment,
          finalPrice: pricingResult.optimalPrice,
          competitorCount: pricingResult.marketAnalysis.competitorCount
        }
      });

      logger.info('Optimal price calculated', {
        taskId: task.id,
        optimalPrice: pricingResult.optimalPrice,
        confidence: pricingResult.confidence,
        reasoning: pricingResult.reasoning
      });

      // 6. 提交报价
      if (qualityAssessment.recommendation === 'accept' || pricingResult.confidence > 0.6) {
        this.stats.tasksQuoted++;
        
        // 使用增强版报价流程
        await this.submitEnhancedBid(task, analysis, pricingResult, executionRecord.id);
      }

    } catch (error) {
      logger.error('Failed to process matched task', { taskId: task.id, error });
    }
  }

  /**
   * 提交增强版报价
   */
  private async submitEnhancedBid(
    task: Task,
    analysis: TaskAnalysis,
    pricingResult: import('./modules/smart-pricing-engine').PricingResult,
    executionRecordId: string
  ): Promise<void> {
    try {
      // 使用 QuoteManager 提交报价
      const bid = await this.quoteManager.processMatchedTask(task, analysis);
      
      if (bid) {
        this.stats.bidsSubmitted++;
        
        // 更新执行记录
        this.learningEngine.updateExecutionResult(executionRecordId, {
          bidAccepted: false // 暂时设为 false，等待后续更新
        });
        
        // 更新业务指标
        this.monitor.recordBusinessMetrics({
          bidsSubmitted: this.stats.bidsSubmitted
        });
        
        logger.info('Enhanced bid submitted successfully', {
          taskId: task.id,
          bidId: bid.id,
          price: bid.priceCny,
          optimalPrice: pricingResult.optimalPrice
        });
      }
    } catch (error) {
      logger.error('Failed to submit enhanced bid', { taskId: task.id, error });
    }
  }

  /**
   * 处理 Webhook 事件
   */
  private async handleWebhook(event: string, payload: any): Promise<void> {
    logger.info('Webhook received', { event, payload });
    
    switch (event) {
      case 'BID_ACCEPTED':
        this.stats.bidsAccepted++;
        this.monitor.recordBusinessMetrics({
          bidsAccepted: this.stats.bidsAccepted
        });
        
        // 更新学习记录
        if (payload.taskId) {
          // 找到对应的执行记录并更新
          // 这里简化处理，实际应该通过 taskId 查找
        }
        break;
        
      case 'ORDER_PAID':
        // 订单已支付，开始执行
        logger.info('Order paid, starting execution', { orderId: payload.orderId });
        break;
        
      case 'ORDER_COMPLETED':
        this.stats.totalRevenue += payload.amount || 0;
        this.stats.totalProfit += payload.profit || 0;
        
        this.monitor.recordBusinessMetrics({
          ordersCompleted: this.stats.bidsAccepted,
          totalRevenue: this.stats.totalRevenue,
          totalProfit: this.stats.totalProfit
        });
        break;
    }
  }

  /**
   * 启动学习报告定时器
   */
  private startLearningReportScheduler(): void {
    // 每 24 小时生成一次报告
    setInterval(() => {
      this.printLearningReport();
    }, 24 * 60 * 60 * 1000);
  }

  /**
   * 打印学习报告
   */
  private printLearningReport(): void {
    const report = this.learningEngine.generateReport('30d');
    console.log(report);
    
    // 同时获取统计信息
    const stats = this.learningEngine.getStats();
    logger.info('Learning engine stats', stats);
  }

  /**
   * 获取 Agent 统计信息
   */
  getStats() {
    return {
      ...this.stats,
      winRate: this.stats.bidsSubmitted > 0 
        ? Math.round((this.stats.bidsAccepted / this.stats.bidsSubmitted) * 100) 
        : 0
    };
  }

  /**
   * 获取性能报告
   */
  getPerformanceReport(timeRange: '1h' | '24h' | '7d' = '24h') {
    return this.monitor.getPerformanceReport(timeRange);
  }

  /**
   * 获取业务报告
   */
  getBusinessReport(timeRange: '1d' | '7d' | '30d' = '7d') {
    return this.monitor.getBusinessReport(timeRange);
  }

  /**
   * 获取学习分析
   */
  getLearningAnalysis(timeRange: '7d' | '30d' | '90d' = '30d') {
    return this.learningEngine.analyzeLearningData(timeRange);
  }

  /**
   * 更新定价配置
   */
  updatePricingConfig(config: Partial<import('./modules/smart-pricing-engine').SmartPricingConfig>) {
    this.pricingEngine.updateConfig(config);
    logger.info('Pricing config updated', config);
  }

  /**
   * 强制生成学习报告
   */
  forceGenerateReport(): string {
    return this.learningEngine.generateReport('30d');
  }
}
