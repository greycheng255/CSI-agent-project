import { Task, TaskAnalysis, Bid, Order } from '../types';
import { getLogger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger();

/**
 * 执行记录
 */
export interface ExecutionRecord {
  id: string;
  timestamp: number;
  taskId: string;
  orderId?: string;
  taskType: string;
  taskCategory: string;
  
  // 预估数据
  estimatedHours: number;
  estimatedPrice: number;
  estimatedComplexity: number | string;
  confidence: number;
  
  // 实际数据
  actualHours?: number;
  actualCost?: number;
  actualPrice?: number;
  
  // 结果
  success: boolean;
  bidAccepted: boolean;
  orderCompleted: boolean;
  
  // 质量评估
  qualityAssessment: {
    score: number;
    riskLevel: string;
    expectedProfit: number;
  };
  
  // 定价策略
  pricingStrategy: {
    basePrice: number;
    marketAdjustment: number;
    finalPrice: number;
    competitorCount: number;
  };
  
  // 执行结果
  executionResult?: {
    error?: string;
    deliverablesCount?: number;
    clientRating?: number;
  };
  
  // 标签（用于机器学习）
  tags: string[];
}

/**
 * 学习分析结果
 */
export interface LearningAnalysis {
  // 定价准确度
  pricingAccuracy: {
    avgDeviation: number;
    overpricedRate: number;
    underpricedRate: number;
    optimalPriceRange: [number, number];
  };
  
  // 工时预估准确度
  timeEstimationAccuracy: {
    avgDeviation: number;
    underestimatedRate: number;
    overestimatedRate: number;
  };
  
  // 任务筛选效果
  taskSelectionEffectiveness: {
    acceptRate: number;
    successRate: number;
    avgProfitMargin: number;
  };
  
  // 策略建议
  recommendations: StrategyRecommendation[];
}

/**
 * 策略建议
 */
export interface StrategyRecommendation {
  type: 'pricing' | 'task_selection' | 'timing' | 'skill';
  priority: 'high' | 'medium' | 'low';
  description: string;
  currentValue: string;
  suggestedValue: string;
  expectedImpact: string;
  confidence: number;
}

/**
 * 自动学习引擎
 * 收集执行数据，分析效果，持续优化策略
 */
export class LearningEngine {
  private dataDir: string;
  private records: ExecutionRecord[] = [];
  private maxRecords: number = 10000;
  private analysisCache: Map<string, LearningAnalysis> = new Map();
  
  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;
    this.ensureDataDir();
    this.loadRecords();
  }
  
  /**
   * 确保数据目录存在
   */
  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      logger.info('Data directory created', { path: this.dataDir });
    }
  }
  
  /**
   * 加载历史记录
   */
  private loadRecords(): void {
    const filePath = path.join(this.dataDir, 'execution-records.json');
    
    if (fs.existsSync(filePath)) {
      try {
        const data = fs.readFileSync(filePath, 'utf-8');
        this.records = JSON.parse(data);
        logger.info('Execution records loaded', { count: this.records.length });
      } catch (error) {
        logger.error('Failed to load execution records', { error });
        this.records = [];
      }
    }
  }
  
  /**
   * 保存记录到文件
   */
  private saveRecords(): void {
    const filePath = path.join(this.dataDir, 'execution-records.json');
    
    try {
      fs.writeFileSync(filePath, JSON.stringify(this.records, null, 2));
      logger.debug('Execution records saved', { count: this.records.length });
    } catch (error) {
      logger.error('Failed to save execution records', { error });
    }
  }
  
  /**
   * 记录任务执行数据
   */
  recordExecution(
    task: Task,
    analysis: TaskAnalysis,
    qualityAssessment: { score: number; riskLevel: string; expectedProfit: number },
    pricingStrategy: { basePrice: number; marketAdjustment: number; finalPrice: number; competitorCount: number }
  ): ExecutionRecord {
    const record: ExecutionRecord = {
      id: `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      taskId: task.id,
      taskType: this.classifyTaskType(task),
      taskCategory: this.classifyTaskCategory(task, analysis),
      estimatedHours: analysis.timeEstimate,
      estimatedPrice: pricingStrategy.finalPrice,
      estimatedComplexity: analysis.estimatedComplexity,
      confidence: analysis.confidence,
      success: false,
      bidAccepted: false,
      orderCompleted: false,
      qualityAssessment,
      pricingStrategy,
      tags: this.generateTags(task, analysis)
    };
    
    this.records.push(record);
    
    // 限制记录数量
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
    
    // 异步保存
    setImmediate(() => this.saveRecords());
    
    logger.info('Execution recorded', {
      recordId: record.id,
      taskId: task.id,
      estimatedPrice: record.estimatedPrice
    });
    
    return record;
  }
  
  /**
   * 更新执行结果
   */
  updateExecutionResult(
    recordId: string,
    updates: Partial<ExecutionRecord>
  ): void {
    const record = this.records.find(r => r.id === recordId);
    
    if (!record) {
      logger.warn('Execution record not found', { recordId });
      return;
    }
    
    Object.assign(record, updates);
    
    setImmediate(() => this.saveRecords());
    
    logger.info('Execution result updated', {
      recordId,
      updates: Object.keys(updates)
    });
  }
  
  /**
   * 分类任务类型
   */
  private classifyTaskType(task: Task): string {
    const title = task.title.toLowerCase();
    const desc = task.description.toLowerCase();
    
    if (title.includes('爬虫') || title.includes('采集') || desc.includes('爬取')) {
      return 'data_collection';
    }
    if (title.includes('api') || title.includes('接口')) {
      return 'api_development';
    }
    if (title.includes('处理') || title.includes('分析')) {
      return 'data_processing';
    }
    if (title.includes('自动化') || title.includes('脚本')) {
      return 'automation';
    }
    if (title.includes('网站') || title.includes('web')) {
      return 'web_development';
    }
    
    return 'other';
  }
  
  /**
   * 分类任务类别
   */
  private classifyTaskCategory(task: Task, analysis: TaskAnalysis): string {
    const complexity = analysis.estimatedComplexity;
    
    if (typeof complexity === 'number') {
      if (complexity <= 3) return 'simple';
      if (complexity <= 6) return 'moderate';
      if (complexity <= 8) return 'complex';
      return 'expert';
    }
    
    return (complexity as string) || 'unknown';
  }
  
  /**
   * 生成标签
   */
  private generateTags(task: Task, analysis: TaskAnalysis): string[] {
    const tags: string[] = [];
    
    // 预算标签
    if (task.budgetCny < 200) tags.push('low_budget');
    else if (task.budgetCny < 500) tags.push('medium_budget');
    else tags.push('high_budget');
    
    // 复杂度标签
    const complexity = analysis.estimatedComplexity;
    if (typeof complexity === 'number') {
      if (complexity <= 3) tags.push('simple');
      else if (complexity <= 6) tags.push('moderate');
      else if (complexity <= 8) tags.push('complex');
      else tags.push('expert');
    }
    
    // 时间压力标签
    const deadline = new Date(task.expectedDeliveryAt);
    const hoursUntil = (deadline.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntil < 24) tags.push('urgent');
    else if (hoursUntil < 72) tags.push('time_sensitive');
    else tags.push('relaxed');
    
    return tags;
  }
  
  /**
   * 分析学习数据
   */
  analyzeLearningData(timeRange: '7d' | '30d' | '90d' = '30d'): LearningAnalysis {
    const cacheKey = `${timeRange}-${Date.now()}`;
    
    // 检查缓存
    if (this.analysisCache.has(cacheKey)) {
      return this.analysisCache.get(cacheKey)!;
    }
    
    const now = Date.now();
    const ranges: Record<string, number> = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000
    };
    const cutoff = now - ranges[timeRange];
    
    const recentRecords = this.records.filter(r => r.timestamp > cutoff);
    
    if (recentRecords.length === 0) {
      return this.getEmptyAnalysis();
    }
    
    // 定价准确度分析
    const pricingAccuracy = this.analyzePricingAccuracy(recentRecords);
    
    // 工时预估准确度分析
    const timeEstimationAccuracy = this.analyzeTimeEstimationAccuracy(recentRecords);
    
    // 任务筛选效果分析
    const taskSelectionEffectiveness = this.analyzeTaskSelectionEffectiveness(recentRecords);
    
    // 生成策略建议
    const recommendations = this.generateRecommendations(
      recentRecords,
      pricingAccuracy,
      timeEstimationAccuracy,
      taskSelectionEffectiveness
    );
    
    const analysis: LearningAnalysis = {
      pricingAccuracy,
      timeEstimationAccuracy,
      taskSelectionEffectiveness,
      recommendations
    };
    
    // 缓存结果
    this.analysisCache.set(cacheKey, analysis);
    
    // 限制缓存大小
    if (this.analysisCache.size > 10) {
      const firstKey = this.analysisCache.keys().next().value;
      if (firstKey) {
        this.analysisCache.delete(firstKey);
      }
    }
    
    logger.info('Learning analysis completed', {
      timeRange,
      recordCount: recentRecords.length,
      recommendationCount: recommendations.length
    });
    
    return analysis;
  }
  
  /**
   * 分析定价准确度
   */
  private analyzePricingAccuracy(records: ExecutionRecord[]): LearningAnalysis['pricingAccuracy'] {
    const completedRecords = records.filter(r => r.actualPrice !== undefined);
    
    if (completedRecords.length === 0) {
      return {
        avgDeviation: 0,
        overpricedRate: 0,
        underpricedRate: 0,
        optimalPriceRange: [0, 0]
      };
    }
    
    const deviations = completedRecords.map(r => {
      const actual = r.actualPrice || r.estimatedPrice;
      return (r.estimatedPrice - actual) / actual;
    });
    
    const avgDeviation = deviations.reduce((sum, d) => sum + d, 0) / deviations.length;
    const overpricedCount = deviations.filter(d => d > 0.1).length;
    const underpricedCount = deviations.filter(d => d < -0.1).length;
    
    // 计算最优价格区间
    const successfulBids = completedRecords.filter(r => r.bidAccepted);
    const prices = successfulBids.map(r => r.estimatedPrice);
    
    let optimalPriceRange: [number, number] = [0, 0];
    if (prices.length > 0) {
      const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
      const stdDev = Math.sqrt(
        prices.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / prices.length
      );
      optimalPriceRange = [avg - stdDev, avg + stdDev];
    }
    
    return {
      avgDeviation: Math.round(avgDeviation * 100) / 100,
      overpricedRate: Math.round((overpricedCount / deviations.length) * 100),
      underpricedRate: Math.round((underpricedCount / deviations.length) * 100),
      optimalPriceRange
    };
  }
  
  /**
   * 分析工时预估准确度
   */
  private analyzeTimeEstimationAccuracy(records: ExecutionRecord[]): LearningAnalysis['timeEstimationAccuracy'] {
    const completedRecords = records.filter(r => r.actualHours !== undefined);
    
    if (completedRecords.length === 0) {
      return {
        avgDeviation: 0,
        underestimatedRate: 0,
        overestimatedRate: 0
      };
    }
    
    const deviations = completedRecords.map(r => {
      const actual = r.actualHours || r.estimatedHours;
      return (r.estimatedHours - actual) / actual;
    });
    
    const avgDeviation = deviations.reduce((sum, d) => sum + d, 0) / deviations.length;
    const underestimatedCount = deviations.filter(d => d < -0.2).length;
    const overestimatedCount = deviations.filter(d => d > 0.2).length;
    
    return {
      avgDeviation: Math.round(avgDeviation * 100) / 100,
      underestimatedRate: Math.round((underestimatedCount / deviations.length) * 100),
      overestimatedRate: Math.round((overestimatedCount / deviations.length) * 100)
    };
  }
  
  /**
   * 分析任务筛选效果
   */
  private analyzeTaskSelectionEffectiveness(records: ExecutionRecord[]): LearningAnalysis['taskSelectionEffectiveness'] {
    if (records.length === 0) {
      return {
        acceptRate: 0,
        successRate: 0,
        avgProfitMargin: 0
      };
    }
    
    const acceptedRecords = records.filter(r => r.bidAccepted);
    const completedRecords = records.filter(r => r.orderCompleted);
    
    const profitMargins = completedRecords.map(r => {
      if (r.actualCost && r.actualPrice) {
        return (r.actualPrice - r.actualCost) / r.actualPrice;
      }
      return 0;
    });
    
    const avgProfitMargin = profitMargins.length > 0
      ? profitMargins.reduce((sum, m) => sum + m, 0) / profitMargins.length
      : 0;
    
    return {
      acceptRate: Math.round((acceptedRecords.length / records.length) * 100),
      successRate: Math.round((completedRecords.length / Math.max(acceptedRecords.length, 1)) * 100),
      avgProfitMargin: Math.round(avgProfitMargin * 100)
    };
  }
  
  /**
   * 生成策略建议
   */
  private generateRecommendations(
    records: ExecutionRecord[],
    pricingAccuracy: LearningAnalysis['pricingAccuracy'],
    timeEstimationAccuracy: LearningAnalysis['timeEstimationAccuracy'],
    taskSelection: LearningAnalysis['taskSelectionEffectiveness']
  ): StrategyRecommendation[] {
    const recommendations: StrategyRecommendation[] = [];
    
    // 定价建议
    if (pricingAccuracy.overpricedRate > 30) {
      recommendations.push({
        type: 'pricing',
        priority: 'high',
        description: '报价过高导致中标率低',
        currentValue: `过高报价率: ${pricingAccuracy.overpricedRate}%`,
        suggestedValue: '降低基础费率或市场竞争系数',
        expectedImpact: '中标率提升 15-20%',
        confidence: 0.8
      });
    }
    
    if (pricingAccuracy.underpricedRate > 30) {
      recommendations.push({
        type: 'pricing',
        priority: 'medium',
        description: '报价过低导致利润损失',
        currentValue: `过低报价率: ${pricingAccuracy.underpricedRate}%`,
        suggestedValue: '提高最低利润率阈值',
        expectedImpact: '利润率提升 10-15%',
        confidence: 0.75
      });
    }
    
    // 工时预估建议
    if (timeEstimationAccuracy.underestimatedRate > 40) {
      recommendations.push({
        type: 'task_selection',
        priority: 'high',
        description: '工时预估普遍偏低',
        currentValue: `低估率: ${timeEstimationAccuracy.underestimatedRate}%`,
        suggestedValue: '增加复杂度系数或预留缓冲时间',
        expectedImpact: '减少延期风险 25%',
        confidence: 0.85
      });
    }
    
    // 任务筛选建议
    if (taskSelection.acceptRate < 15) {
      recommendations.push({
        type: 'task_selection',
        priority: 'medium',
        description: '中标率偏低',
        currentValue: `中标率: ${taskSelection.acceptRate}%`,
        suggestedValue: '放宽质量评估标准或优化定价策略',
        expectedImpact: '中标率提升 5-10%',
        confidence: 0.7
      });
    }
    
    // 时间建议
    const hourlyDistribution = this.analyzeHourlyDistribution(records);
    if (hourlyDistribution.bestHours.length > 0) {
      recommendations.push({
        type: 'timing',
        priority: 'low',
        description: '发现最佳报价时间窗口',
        currentValue: '全天均匀报价',
        suggestedValue: `优先在 ${hourlyDistribution.bestHours.join(', ')} 点报价`,
        expectedImpact: '中标率提升 5-8%',
        confidence: 0.6
      });
    }
    
    // 技能建议
    const skillAnalysis = this.analyzeSkillPerformance(records);
    if (skillAnalysis.bestPerformingSkill) {
      recommendations.push({
        type: 'skill',
        priority: 'medium',
        description: '发现高成功率技能领域',
        currentValue: '均匀分配接单类型',
        suggestedValue: `优先接取 ${skillAnalysis.bestPerformingSkill} 类型任务`,
        expectedImpact: '成功率提升 10-15%',
        confidence: 0.75
      });
    }
    
    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }
  
  /**
   * 分析小时分布
   */
  private analyzeHourlyDistribution(records: ExecutionRecord[]): { bestHours: number[] } {
    const hourlySuccess: Map<number, { total: number; success: number }> = new Map();
    
    for (const record of records) {
      const hour = new Date(record.timestamp).getHours();
      const current = hourlySuccess.get(hour) || { total: 0, success: 0 };
      current.total++;
      if (record.bidAccepted) {
        current.success++;
      }
      hourlySuccess.set(hour, current);
    }
    
    const bestHours: number[] = [];
    for (const [hour, data] of hourlySuccess) {
      if (data.total >= 5) {
        const rate = data.success / data.total;
        if (rate > 0.3) {
          bestHours.push(hour);
        }
      }
    }
    
    return { bestHours };
  }
  
  /**
   * 分析技能表现
   */
  private analyzeSkillPerformance(records: ExecutionRecord[]): { bestPerformingSkill?: string } {
    const skillStats: Map<string, { total: number; success: number }> = new Map();
    
    for (const record of records) {
      const skill = record.taskType;
      const current = skillStats.get(skill) || { total: 0, success: 0 };
      current.total++;
      if (record.bidAccepted) {
        current.success++;
      }
      skillStats.set(skill, current);
    }
    
    let bestSkill: string | undefined;
    let bestRate = 0;
    
    for (const [skill, data] of skillStats) {
      if (data.total >= 5) {
        const rate = data.success / data.total;
        if (rate > bestRate) {
          bestRate = rate;
          bestSkill = skill;
        }
      }
    }
    
    return { bestPerformingSkill: bestSkill };
  }
  
  /**
   * 获取空分析结果
   */
  private getEmptyAnalysis(): LearningAnalysis {
    return {
      pricingAccuracy: {
        avgDeviation: 0,
        overpricedRate: 0,
        underpricedRate: 0,
        optimalPriceRange: [0, 0]
      },
      timeEstimationAccuracy: {
        avgDeviation: 0,
        underestimatedRate: 0,
        overestimatedRate: 0
      },
      taskSelectionEffectiveness: {
        acceptRate: 0,
        successRate: 0,
        avgProfitMargin: 0
      },
      recommendations: []
    };
  }
  
  /**
   * 生成学习报告
   */
  generateReport(timeRange: '7d' | '30d' | '90d' = '30d'): string {
    const analysis = this.analyzeLearningData(timeRange);
    
    let report = `\n`;
    report += `╔══════════════════════════════════════════════════════════════╗\n`;
    report += `║           Genesis Agent 学习分析报告 (${timeRange})          ║\n`;
    report += `╚══════════════════════════════════════════════════════════════╝\n\n`;
    
    // 定价准确度
    report += `【定价准确度】\n`;
    report += `  平均偏差: ${(analysis.pricingAccuracy.avgDeviation * 100).toFixed(1)}%\n`;
    report += `  过高报价率: ${analysis.pricingAccuracy.overpricedRate}%\n`;
    report += `  过低报价率: ${analysis.pricingAccuracy.underpricedRate}%\n`;
    report += `  最优价格区间: ¥${analysis.pricingAccuracy.optimalPriceRange[0].toFixed(0)} - ¥${analysis.pricingAccuracy.optimalPriceRange[1].toFixed(0)}\n\n`;
    
    // 工时预估准确度
    report += `【工时预估准确度】\n`;
    report += `  平均偏差: ${(analysis.timeEstimationAccuracy.avgDeviation * 100).toFixed(1)}%\n`;
    report += `  低估率: ${analysis.timeEstimationAccuracy.underestimatedRate}%\n`;
    report += `  高估率: ${analysis.timeEstimationAccuracy.overestimatedRate}%\n\n`;
    
    // 任务筛选效果
    report += `【任务筛选效果】\n`;
    report += `  中标率: ${analysis.taskSelectionEffectiveness.acceptRate}%\n`;
    report += `  成功率: ${analysis.taskSelectionEffectiveness.successRate}%\n`;
    report += `  平均利润率: ${analysis.taskSelectionEffectiveness.avgProfitMargin}%\n\n`;
    
    // 策略建议
    report += `【策略建议】\n`;
    if (analysis.recommendations.length === 0) {
      report += `  暂无建议，数据积累中...\n`;
    } else {
      for (let i = 0; i < analysis.recommendations.length; i++) {
        const rec = analysis.recommendations[i];
        const priorityIcon = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
        report += `\n  ${i + 1}. ${priorityIcon} [${rec.type.toUpperCase()}] ${rec.description}\n`;
        report += `     当前: ${rec.currentValue}\n`;
        report += `     建议: ${rec.suggestedValue}\n`;
        report += `     预期效果: ${rec.expectedImpact} (置信度: ${(rec.confidence * 100).toFixed(0)}%)\n`;
      }
    }
    
    report += `\n`;
    report += `═══════════════════════════════════════════════════════════════\n`;
    report += `报告生成时间: ${new Date().toLocaleString()}\n`;
    report += `═══════════════════════════════════════════════════════════════\n`;
    
    return report;
  }
  
  /**
   * 获取统计信息
   */
  getStats(): {
    totalRecords: number;
    acceptedBids: number;
    completedOrders: number;
    successRate: number;
  } {
    const accepted = this.records.filter(r => r.bidAccepted).length;
    const completed = this.records.filter(r => r.orderCompleted).length;
    
    return {
      totalRecords: this.records.length,
      acceptedBids: accepted,
      completedOrders: completed,
      successRate: this.records.length > 0 ? Math.round((completed / this.records.length) * 100) : 0
    };
  }
  
  /**
   * 清除所有记录
   */
  clearRecords(): void {
    this.records = [];
    this.saveRecords();
    logger.info('All execution records cleared');
  }
  
  /**
   * 导出数据
   */
  exportData(): ExecutionRecord[] {
    return [...this.records];
  }
  
  /**
   * 导入数据
   */
  importData(data: ExecutionRecord[]): void {
    this.records = data;
    this.saveRecords();
    logger.info('Data imported', { count: data.length });
  }
}
