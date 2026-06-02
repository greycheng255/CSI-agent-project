import { GenesisClient } from './genesis-client';
import { SkillsManager } from './skills-manager';
import { TaskQualityAssessor } from './task-quality-assessor';
import { SmartPricingEngine } from './smart-pricing-engine';
import { LearningEngine } from './learning-engine';
import { AgentMonitor } from './agent-monitor';
import { AutoPipeline, AutoPipelineConfig, PipelineState } from './auto-pipeline';
import { Task, TaskAnalysis, Order, Bid } from '../types';
import { getLogger } from '../utils/logger';

const logger = getLogger();

/**
 * 自动化级别
 */
export type AutomationLevel = 'manual' | 'semi' | 'full' | 'aggressive';

/**
 * 自动化配置预设
 */
const AUTOMATION_PRESETS: Record<AutomationLevel, Partial<AutoPipelineConfig>> = {
  manual: {
    minQualityScore: 0.8,
    minProfitMargin: 0.4,
    maxRiskLevel: 'low',
    autoExecute: false,
    autoSubmitDelivery: false,
    autoAdjustPrice: false,
    autoRetry: false,
    autoOptimize: false
  },
  semi: {
    minQualityScore: 0.5,
    minProfitMargin: 0.3,
    maxRiskLevel: 'medium',
    autoExecute: true,
    autoSubmitDelivery: false,
    autoAdjustPrice: true,
    autoRetry: true,
    autoOptimize: true
  },
  full: {
    minQualityScore: 0.3,
    minProfitMargin: 0.25,
    maxRiskLevel: 'medium',
    autoExecute: true,
    autoSubmitDelivery: true,
    autoAdjustPrice: true,
    autoRetry: true,
    autoOptimize: true
  },
  aggressive: {
    minQualityScore: 0.1,
    minProfitMargin: 0.15,
    maxRiskLevel: 'high',
    autoExecute: true,
    autoSubmitDelivery: true,
    autoAdjustPrice: true,
    autoRetry: true,
    autoOptimize: true
  }
};

/**
 * 自动化统计
 */
export interface AutomationStats {
  totalTasksProcessed: number;
  tasksAccepted: number;
  tasksRejected: number;
  bidsSubmitted: number;
  bidsAccepted: number;
  ordersExecuted: number;
  ordersCompleted: number;
  successRate: number;
  avgProfitMargin: number;
  automationLevel: AutomationLevel;
  isRunning: boolean;
}

/**
 * 自动化管理器
 * 统一管理所有自动化功能，提供一键自动化配置
 */
export class AutoManager {
  private genesisClient: GenesisClient;
  private skillsManager: SkillsManager;
  private qualityAssessor: TaskQualityAssessor;
  private pricingEngine: SmartPricingEngine;
  private learningEngine: LearningEngine;
  private monitor: AgentMonitor;
  private pipeline: AutoPipeline;
  
  private agentId: string;
  private webhookUrl: string;
  private currentLevel: AutomationLevel = 'semi';
  private isRunning = false;
  
  // 统计
  private stats = {
    totalTasksProcessed: 0,
    tasksAccepted: 0,
    tasksRejected: 0,
    bidsSubmitted: 0,
    bidsAccepted: 0,
    ordersExecuted: 0,
    ordersCompleted: 0,
    totalProfit: 0
  };

  constructor(
    genesisClient: GenesisClient,
    skillsManager: SkillsManager,
    agentId: string,
    webhookUrl: string
  ) {
    this.genesisClient = genesisClient;
    this.skillsManager = skillsManager;
    this.agentId = agentId;
    this.webhookUrl = webhookUrl;
    
    // 初始化子模块
    this.qualityAssessor = new TaskQualityAssessor(genesisClient);
    this.pricingEngine = new SmartPricingEngine(genesisClient);
    this.learningEngine = new LearningEngine('./data');
    this.monitor = new AgentMonitor(genesisClient, agentId);
    
    // 初始化流水线
    this.pipeline = new AutoPipeline(
      genesisClient,
      skillsManager,
      this.qualityAssessor,
      this.pricingEngine,
      this.learningEngine,
      this.monitor,
      agentId,
      webhookUrl,
      AUTOMATION_PRESETS[this.currentLevel]
    );
    
    logger.info('AutoManager initialized', { level: this.currentLevel });
  }

  /**
   * 启动自动化
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('AutoManager is already running');
      return;
    }

    this.isRunning = true;
    
    // 启动监控
    this.monitor.startMonitoring(60000);
    
    // 启动定期优化
    this.startAutoOptimization();
    
    logger.info('AutoManager started', { level: this.currentLevel });
  }

  /**
   * 停止自动化
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.monitor.stopMonitoring();
    
    logger.info('AutoManager stopped');
  }

  /**
   * 处理新任务
   */
  async processTask(task: Task, analysis: TaskAnalysis): Promise<void> {
    this.stats.totalTasksProcessed++;
    
    try {
      await this.pipeline.processTask(task, analysis);
      this.stats.tasksAccepted++;
    } catch (error) {
      this.stats.tasksRejected++;
      logger.info('Task auto-rejected', { taskId: task.id, error });
    }
  }

  /**
   * 处理中标事件
   */
  async handleBidAccepted(order: Order, bid: Bid): Promise<void> {
    this.stats.bidsAccepted++;
    await this.pipeline.handleBidAccepted(order, bid);
    this.stats.ordersExecuted++;
  }

  /**
   * 设置自动化级别
   */
  setAutomationLevel(level: AutomationLevel): void {
    this.currentLevel = level;
    this.pipeline.updateConfig(AUTOMATION_PRESETS[level]);
    
    logger.info('Automation level changed', { 
      level, 
      config: AUTOMATION_PRESETS[level] 
    });
  }

  /**
   * 获取当前自动化级别
   */
  getAutomationLevel(): AutomationLevel {
    return this.currentLevel;
  }

  /**
   * 获取自动化统计
   */
  getStats(): AutomationStats {
    const successRate = this.stats.bidsAccepted > 0
      ? Math.round((this.stats.ordersCompleted / this.stats.bidsAccepted) * 100)
      : 0;
    
    const avgProfitMargin = this.stats.ordersCompleted > 0
      ? Math.round((this.stats.totalProfit / this.stats.ordersCompleted))
      : 0;

    return {
      totalTasksProcessed: this.stats.totalTasksProcessed,
      tasksAccepted: this.stats.tasksAccepted,
      tasksRejected: this.stats.tasksRejected,
      bidsSubmitted: this.stats.bidsSubmitted,
      bidsAccepted: this.stats.bidsAccepted,
      ordersExecuted: this.stats.ordersExecuted,
      ordersCompleted: this.stats.ordersCompleted,
      successRate,
      avgProfitMargin,
      automationLevel: this.currentLevel,
      isRunning: this.isRunning
    };
  }

  /**
   * 获取流水线状态
   */
  getPipelineState(taskId: string): PipelineState | undefined {
    return this.pipeline.getPipelineState(taskId);
  }

  /**
   * 获取所有流水线
   */
  getAllPipelines(): PipelineState[] {
    return this.pipeline.getAllPipelines();
  }

  /**
   * 生成学习报告
   */
  generateLearningReport(): string {
    return this.learningEngine.generateReport('30d');
  }

  /**
   * 启动自动优化
   */
  private startAutoOptimization(): void {
    const interval = AUTOMATION_PRESETS[this.currentLevel].autoOptimize
      ? (AUTOMATION_PRESETS[this.currentLevel].optimizationInterval || 24) * 60 * 60 * 1000
      : 0;
    
    if (interval > 0) {
      setInterval(() => {
        this.performAutoOptimization();
      }, interval);
    }
  }

  /**
   * 执行自动优化
   */
  private performAutoOptimization(): void {
    logger.info('Running auto-optimization...');
    
    const analysis = this.learningEngine.analyzeLearningData('30d');
    
    if (analysis.recommendations.length > 0) {
      // 应用高优先级的建议
      const highPriorityRecs = analysis.recommendations.filter(r => r.priority === 'high');
      
      for (const rec of highPriorityRecs) {
        this.applyRecommendation(rec);
      }
      
      logger.info('Auto-optimization completed', {
        recommendationsApplied: highPriorityRecs.length
      });
    }
  }

  /**
   * 应用优化建议
   */
  private applyRecommendation(rec: any): void {
    switch (rec.type) {
      case 'pricing':
        if (rec.description.includes('基础费率')) {
          const match = rec.suggestedValue.match(/¥(\d+)/);
          if (match) {
            const newRate = parseInt(match[1]);
            this.pricingEngine.updateConfig({ baseRateCny: newRate });
            logger.info('Applied pricing optimization', { newRate });
          }
        }
        break;
        
      case 'task_selection':
        if (rec.description.includes('利润率')) {
          const match = rec.suggestedValue.match(/(\d+)%/);
          if (match) {
            const newMargin = parseInt(match[1]) / 100;
            this.pipeline.updateConfig({ minProfitMargin: newMargin });
            logger.info('Applied task selection optimization', { newMargin });
          }
        }
        break;
    }
  }

  /**
   * 暂停自动化（保留状态）
   */
  pause(): void {
    this.isRunning = false;
    logger.info('Automation paused');
  }

  /**
   * 恢复自动化
   */
  resume(): void {
    this.isRunning = true;
    logger.info('Automation resumed');
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalTasksProcessed: 0,
      tasksAccepted: 0,
      tasksRejected: 0,
      bidsSubmitted: 0,
      bidsAccepted: 0,
      ordersExecuted: 0,
      ordersCompleted: 0,
      totalProfit: 0
    };
    logger.info('Statistics reset');
  }
}
