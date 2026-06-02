import { Task, TaskAnalysis } from '../types';
import { GenesisClient } from './genesis-client';
import { getLogger } from '../utils/logger';

const logger = getLogger();

/**
 * 任务质量评估结果
 */
export interface TaskQualityAssessment {
  score: number;                    // -1 到 1 的分数
  recommendation: 'accept' | 'review' | 'reject';
  reasons: string[];
  expectedProfit: number;
  riskLevel: 'low' | 'medium' | 'high';
  details: {
    profitMargin: number;
    clientScore: number;
    complexityScore: number;
    timePressureScore: number;
    competitionScore: number;
  };
}

/**
 * 客户历史记录
 */
interface ClientHistory {
  clientId: string;
  totalTasks: number;
  completedTasks: number;
  acceptanceRate: number;
  averagePaymentTime: number;       // 天
  disputeRate: number;
  averageRating: number;
  lastActivity: Date;
}

/**
 * 任务质量评估器
 * 智能筛选高质量任务，最大化利润并降低风险
 */
export class TaskQualityAssessor {
  private genesisClient: GenesisClient;
  private clientHistoryCache: Map<string, ClientHistory> = new Map();
  private minProfitMargin: number = 0.25;  // 最低利润率 25%
  private minAcceptableProfit: number = 100; // 最低可接受利润 ¥100

  constructor(genesisClient: GenesisClient) {
    this.genesisClient = genesisClient;
  }

  /**
   * 评估任务质量和盈利潜力
   * 返回评估结果和推荐决策
   */
  async assessTaskQuality(
    task: Task,
    analysis: TaskAnalysis,
    estimatedCost: number
  ): Promise<TaskQualityAssessment> {
    const startTime = Date.now();
    logger.info('Starting task quality assessment', {
      taskId: task.id,
      title: task.title,
      budget: task.budgetCny
    });

    let score = 0;
    const reasons: string[] = [];
    const details = {
      profitMargin: 0,
      clientScore: 0,
      complexityScore: 0,
      timePressureScore: 0,
      competitionScore: 0
    };

    // 1. 利润率评估 (权重: 0.35)
    const profitAssessment = await this.assessProfitability(task, estimatedCost);
    details.profitMargin = profitAssessment.margin;
    score += profitAssessment.score * 0.35;
    reasons.push(...profitAssessment.reasons);

    // 2. 客户质量评估 (权重: 0.25)
    const clientAssessment = await this.assessClientQuality(task.clientUserId);
    details.clientScore = clientAssessment.score;
    score += clientAssessment.score * 0.25;
    reasons.push(...clientAssessment.reasons);

    // 3. 复杂度评估 (权重: 0.15)
    const complexityAssessment = this.assessComplexity(analysis);
    details.complexityScore = complexityAssessment.score;
    score += complexityAssessment.score * 0.15;
    reasons.push(...complexityAssessment.reasons);

    // 4. 时间压力评估 (权重: 0.10)
    const timeAssessment = this.assessTimePressure(task);
    details.timePressureScore = timeAssessment.score;
    score += timeAssessment.score * 0.10;
    reasons.push(...timeAssessment.reasons);

    // 5. 竞争程度评估 (权重: 0.15)
    const competitionAssessment = await this.assessCompetition(task.id);
    details.competitionScore = competitionAssessment.score;
    score += competitionAssessment.score * 0.15;
    reasons.push(...competitionAssessment.reasons);

    // 计算预期利润
    const expectedProfit = task.budgetCny - estimatedCost;

    // 确定推荐决策
    let recommendation: 'accept' | 'review' | 'reject';
    let riskLevel: 'low' | 'medium' | 'high';

    if (score > 0.5 && expectedProfit >= this.minAcceptableProfit) {
      recommendation = 'accept';
      riskLevel = 'low';
    } else if (score > 0.2 && expectedProfit >= this.minAcceptableProfit * 0.5) {
      recommendation = 'review';
      riskLevel = 'medium';
    } else {
      recommendation = 'reject';
      riskLevel = 'high';
    }

    const assessment: TaskQualityAssessment = {
      score,
      recommendation,
      reasons,
      expectedProfit,
      riskLevel,
      details
    };

    const duration = Date.now() - startTime;
    logger.info('Task quality assessment completed', {
      taskId: task.id,
      score,
      recommendation,
      riskLevel,
      expectedProfit,
      duration: `${duration}ms`
    });

    return assessment;
  }

  /**
   * 评估利润率
   */
  private async assessProfitability(
    task: Task,
    estimatedCost: number
  ): Promise<{ score: number; margin: number; reasons: string[] }> {
    const profit = task.budgetCny - estimatedCost;
    const margin = profit / task.budgetCny;
    const reasons: string[] = [];
    let score = 0;

    if (margin >= 0.5) {
      score = 1.0;
      reasons.push(`🟢 极高利润率: ${(margin * 100).toFixed(1)}%`);
    } else if (margin >= 0.4) {
      score = 0.8;
      reasons.push(`🟢 高利润率: ${(margin * 100).toFixed(1)}%`);
    } else if (margin >= 0.25) {
      score = 0.5;
      reasons.push(`🟡 合理利润率: ${(margin * 100).toFixed(1)}%`);
    } else if (margin >= 0.1) {
      score = 0.2;
      reasons.push(`🟠 低利润率: ${(margin * 100).toFixed(1)}%`);
    } else {
      score = -0.5;
      reasons.push(`🔴 利润率过低: ${(margin * 100).toFixed(1)}%`);
    }

    // 绝对利润检查
    if (profit < this.minAcceptableProfit) {
      score -= 0.3;
      reasons.push(`🔴 绝对利润不足: ¥${profit.toFixed(2)} < ¥${this.minAcceptableProfit}`);
    } else if (profit > 500) {
      score += 0.1;
      reasons.push(`🟢 高绝对利润: ¥${profit.toFixed(2)}`);
    }

    return { score, margin, reasons };
  }

  /**
   * 评估客户质量
   */
  private async assessClientQuality(
    clientId: string
  ): Promise<{ score: number; reasons: string[] }> {
    const reasons: string[] = [];

    try {
      const history = await this.getClientHistory(clientId);

      if (!history || history.totalTasks === 0) {
        reasons.push('🟡 新客户，无历史记录');
        return { score: 0.3, reasons };
      }

      let score = 0.5;

      // 验收率评估
      if (history.acceptanceRate >= 0.95) {
        score += 0.3;
        reasons.push(`🟢 客户验收率极高: ${(history.acceptanceRate * 100).toFixed(1)}%`);
      } else if (history.acceptanceRate >= 0.85) {
        score += 0.15;
        reasons.push(`🟢 客户验收率良好: ${(history.acceptanceRate * 100).toFixed(1)}%`);
      } else if (history.acceptanceRate < 0.7) {
        score -= 0.3;
        reasons.push(`🔴 客户验收率低: ${(history.acceptanceRate * 100).toFixed(1)}%`);
      }

      // 付款及时性
      if (history.averagePaymentTime <= 1) {
        score += 0.15;
        reasons.push('🟢 客户付款极快');
      } else if (history.averagePaymentTime <= 3) {
        score += 0.05;
        reasons.push('🟡 客户付款及时');
      } else if (history.averagePaymentTime > 7) {
        score -= 0.15;
        reasons.push(`🔴 客户付款较慢: ${history.averagePaymentTime.toFixed(1)}天`);
      }

      // 争议率
      if (history.disputeRate > 0.1) {
        score -= 0.3;
        reasons.push(`🔴 客户争议率高: ${(history.disputeRate * 100).toFixed(1)}%`);
      } else if (history.disputeRate < 0.02) {
        score += 0.1;
        reasons.push('🟢 客户争议率极低');
      }

      // 任务量（活跃度）
      if (history.totalTasks > 10) {
        score += 0.1;
        reasons.push(`🟢 活跃客户: ${history.totalTasks}个历史任务`);
      }

      return { score: Math.max(0, Math.min(1, score)), reasons };
    } catch (error) {
      logger.warn('Failed to assess client quality', { clientId, error });
      reasons.push('🟡 无法获取客户历史');
      return { score: 0.3, reasons };
    }
  }

  /**
   * 获取客户历史记录
   */
  private async getClientHistory(clientId: string): Promise<ClientHistory | null> {
    // 检查缓存
    if (this.clientHistoryCache.has(clientId)) {
      return this.clientHistoryCache.get(clientId)!;
    }

    try {
      // 从 Genesis API 获取客户历史
      const history = await this.genesisClient.getClientHistory(clientId);
      
      if (history) {
        this.clientHistoryCache.set(clientId, history);
      }
      
      return history;
    } catch (error) {
      logger.warn('Failed to fetch client history', { clientId, error });
      return null;
    }
  }

  /**
   * 评估任务复杂度
   */
  private assessComplexity(analysis: TaskAnalysis): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;

    const complexity = analysis.estimatedComplexity;

    if (typeof complexity === 'number') {
      if (complexity <= 3) {
        score = 0.8;
        reasons.push(`🟢 任务简单 (复杂度: ${complexity}/10)`);
      } else if (complexity <= 6) {
        score = 0.5;
        reasons.push(`🟡 任务中等 (复杂度: ${complexity}/10)`);
      } else if (complexity <= 8) {
        score = 0.2;
        reasons.push(`🟠 任务复杂 (复杂度: ${complexity}/10)`);
      } else {
        score = -0.2;
        reasons.push(`🔴 任务极复杂 (复杂度: ${complexity}/10)`);
      }
    } else {
      // 字符串复杂度
      const complexityMap: Record<string, number> = {
        'simple': 0.8,
        'moderate': 0.5,
        'complex': 0.2,
        'expert': -0.2
      };
      score = complexityMap[complexity as string] || 0.3;
      reasons.push(`🟡 任务复杂度: ${complexity}`);
    }

    // 技能匹配度
    if (analysis.confidence >= 0.8) {
      score += 0.2;
      reasons.push(`🟢 技能匹配度高: ${(analysis.confidence * 100).toFixed(1)}%`);
    } else if (analysis.confidence < 0.5) {
      score -= 0.2;
      reasons.push(`🔴 技能匹配度低: ${(analysis.confidence * 100).toFixed(1)}%`);
    }

    return { score: Math.max(-1, Math.min(1, score)), reasons };
  }

  /**
   * 评估时间压力
   */
  private assessTimePressure(task: Task): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;

    const deadline = new Date(task.expectedDeliveryAt);
    const now = new Date();
    const hoursUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
    const daysUntilDeadline = hoursUntilDeadline / 24;

    if (daysUntilDeadline < 1) {
      score = -0.5;
      reasons.push(`🔴 时间极紧迫: 少于1天`);
    } else if (daysUntilDeadline < 2) {
      score = -0.3;
      reasons.push(`🟠 时间紧迫: ${daysUntilDeadline.toFixed(1)}天`);
    } else if (daysUntilDeadline < 3) {
      score = 0;
      reasons.push(`🟡 时间较紧: ${daysUntilDeadline.toFixed(1)}天`);
    } else if (daysUntilDeadline < 7) {
      score = 0.3;
      reasons.push(`🟢 时间合理: ${daysUntilDeadline.toFixed(1)}天`);
    } else {
      score = 0.5;
      reasons.push(`🟢 时间充裕: ${daysUntilDeadline.toFixed(1)}天`);
    }

    return { score, reasons };
  }

  /**
   * 评估竞争程度
   */
  private async assessCompetition(
    taskId: string
  ): Promise<{ score: number; reasons: string[] }> {
    const reasons: string[] = [];

    try {
      const bidCount = await this.genesisClient.getTaskBidCount(taskId);

      if (bidCount === 0) {
        return {
          score: 0.8,
          reasons: ['🟢 蓝海任务: 无竞争']
        };
      } else if (bidCount <= 2) {
        return {
          score: 0.5,
          reasons: [`🟢 竞争较少: ${bidCount}个报价`]
        };
      } else if (bidCount <= 5) {
        return {
          score: 0.2,
          reasons: [`🟡 竞争适中: ${bidCount}个报价`]
        };
      } else {
        return {
          score: -0.2,
          reasons: [`🔴 竞争激烈: ${bidCount}个报价`]
        };
      }
    } catch (error) {
      logger.warn('Failed to assess competition', { taskId, error });
      return {
        score: 0,
        reasons: ['🟡 无法获取竞争信息']
      };
    }
  }

  /**
   * 批量评估多个任务
   */
  async assessTasksBatch(
    tasks: Array<{ task: Task; analysis: TaskAnalysis; estimatedCost: number }>
  ): Promise<Array<{ task: Task; assessment: TaskQualityAssessment }>> {
    const results = await Promise.all(
      tasks.map(async ({ task, analysis, estimatedCost }) => ({
        task,
        assessment: await this.assessTaskQuality(task, analysis, estimatedCost)
      }))
    );

    // 按分数排序
    results.sort((a, b) => b.assessment.score - a.assessment.score);

    return results;
  }

  /**
   * 清除客户历史缓存
   */
  clearCache(): void {
    this.clientHistoryCache.clear();
    logger.info('Client history cache cleared');
  }
}
