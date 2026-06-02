import { Task, TaskAnalysis, Bid } from '../types';
import { GenesisClient } from './genesis-client';
import { getLogger } from '../utils/logger';

const logger = getLogger();

/**
 * 市场分析数据
 */
export interface MarketAnalysis {
  competitorCount: number;
  averageBidPrice: number;
  lowestBidPrice: number;
  highestBidPrice: number;
  medianBidPrice: number;
  priceStdDev: number;
  marketDemand: 'high' | 'medium' | 'low';
}

/**
 * 定价策略配置
 */
export interface SmartPricingConfig {
  baseRateCny: number;
  minProfitMargin: number;
  maxDiscount: number;
  urgencyBonus: number;
  longTermClientDiscount: number;
  competitiveStrategy: 'aggressive' | 'balanced' | 'conservative';
}

/**
 * 定价结果
 */
export interface PricingResult {
  optimalPrice: number;
  confidence: number;
  reasoning: string[];
  breakdown: {
    basePrice: number;
    complexityAdjustment: number;
    marketAdjustment: number;
    urgencyAdjustment: number;
    clientAdjustment: number;
    finalPrice: number;
  };
  marketAnalysis: MarketAnalysis;
}

/**
 * 智能定价引擎
 * 基于市场分析、任务特征和客户关系动态计算最优价格
 */
export class SmartPricingEngine {
  private genesisClient: GenesisClient;
  private config: SmartPricingConfig;

  constructor(
    genesisClient: GenesisClient,
    config: Partial<SmartPricingConfig> = {}
  ) {
    this.genesisClient = genesisClient;
    this.config = {
      baseRateCny: 50,
      minProfitMargin: 0.25,
      maxDiscount: 0.15,
      urgencyBonus: 0.3,
      longTermClientDiscount: 0.05,
      competitiveStrategy: 'balanced',
      ...config
    };
  }

  /**
   * 计算最优报价
   * 综合考虑成本、市场、客户和任务特征
   */
  async calculateOptimalPrice(
    task: Task,
    analysis: TaskAnalysis,
    estimatedHours: number,
    clientId: string
  ): Promise<PricingResult> {
    const startTime = Date.now();
    logger.info('Starting price calculation', {
      taskId: task.id,
      budget: task.budgetCny,
      estimatedHours
    });

    const reasoning: string[] = [];

    // 1. 计算基础价格（成本 + 基础利润）
    const basePrice = this.calculateBasePrice(estimatedHours);
    reasoning.push(`基础价格: ¥${basePrice.toFixed(2)} (${estimatedHours}小时 × ¥${this.config.baseRateCny}/小时)`);

    // 2. 复杂度调整
    const complexityAdjustment = this.calculateComplexityAdjustment(analysis);
    reasoning.push(`复杂度调整: ${complexityAdjustment > 0 ? '+' : ''}${(complexityAdjustment * 100).toFixed(1)}%`);

    // 3. 市场分析调整
    const marketAnalysis = await this.analyzeMarket(task.id);
    const marketAdjustment = this.calculateMarketAdjustment(marketAnalysis, basePrice);
    reasoning.push(`市场调整: ${marketAdjustment > 0 ? '+' : ''}${(marketAdjustment * 100).toFixed(1)}% (${marketAnalysis.competitorCount}个竞争对手)`);

    // 4. 紧急程度调整
    const urgencyAdjustment = this.calculateUrgencyAdjustment(task);
    reasoning.push(`紧急程度调整: ${urgencyAdjustment > 0 ? '+' : ''}${(urgencyAdjustment * 100).toFixed(1)}%`);

    // 5. 客户关系调整
    const clientAdjustment = await this.calculateClientAdjustment(clientId);
    reasoning.push(`客户关系调整: ${clientAdjustment > 0 ? '+' : ''}${(clientAdjustment * 100).toFixed(1)}%`);

    // 6. 计算最终价格
    let finalPrice = basePrice * (1 + complexityAdjustment) * (1 + marketAdjustment) * (1 + urgencyAdjustment) * (1 + clientAdjustment);

    // 7. 确保不低于最低利润率
    const minAcceptablePrice = basePrice * (1 + this.config.minProfitMargin);
    if (finalPrice < minAcceptablePrice) {
      finalPrice = minAcceptablePrice;
      reasoning.push(`价格调整: 提升至最低可接受价格 ¥${minAcceptablePrice.toFixed(2)} (保证${(this.config.minProfitMargin * 100).toFixed(0)}%利润率)`);
    }

    // 8. 不超过预算上限
    if (finalPrice > task.budgetCny * 0.95) {
      finalPrice = task.budgetCny * 0.95;
      reasoning.push(`价格调整: 限制在预算95%以内 ¥${finalPrice.toFixed(2)}`);
    }

    // 9. 取整到整数
    finalPrice = Math.round(finalPrice);

    // 10. 计算置信度
    const confidence = this.calculateConfidence(
      marketAnalysis,
      analysis.confidence,
      finalPrice,
      minAcceptablePrice
    );

    const result: PricingResult = {
      optimalPrice: finalPrice,
      confidence,
      reasoning,
      breakdown: {
        basePrice,
        complexityAdjustment,
        marketAdjustment,
        urgencyAdjustment,
        clientAdjustment,
        finalPrice
      },
      marketAnalysis
    };

    const duration = Date.now() - startTime;
    logger.info('Price calculation completed', {
      taskId: task.id,
      optimalPrice: finalPrice,
      confidence,
      duration: `${duration}ms`,
      reasoning: reasoning.length
    });

    return result;
  }

  /**
   * 计算基础价格
   */
  private calculateBasePrice(estimatedHours: number): number {
    return estimatedHours * this.config.baseRateCny;
  }

  /**
   * 计算复杂度调整系数
   */
  private calculateComplexityAdjustment(analysis: TaskAnalysis): number {
    const complexity = analysis.estimatedComplexity;

    if (typeof complexity === 'number') {
      // 数字复杂度 (0-10)
      if (complexity <= 2) return -0.1;  // 简单任务，降低价格提高竞争力
      if (complexity <= 4) return 0;     // 简单任务，标准价格
      if (complexity <= 6) return 0.15;  // 中等复杂度，加价15%
      if (complexity <= 8) return 0.35;  // 复杂任务，加价35%
      return 0.6;                         // 极复杂任务，加价60%
    } else {
      // 字符串复杂度
      const adjustments: Record<string, number> = {
        'simple': -0.1,
        'moderate': 0.15,
        'complex': 0.35,
        'expert': 0.6
      };
      return adjustments[complexity as string] || 0;
    }
  }

  /**
   * 分析市场竞争情况
   */
  private async analyzeMarket(taskId: string): Promise<MarketAnalysis> {
    try {
      const bids = await this.genesisClient.getTaskBids(taskId);

      if (bids.length === 0) {
        return {
          competitorCount: 0,
          averageBidPrice: 0,
          lowestBidPrice: 0,
          highestBidPrice: 0,
          medianBidPrice: 0,
          priceStdDev: 0,
          marketDemand: 'high'  // 无竞争，需求高
        };
      }

      const prices = bids.map(b => b.priceCny).sort((a, b) => a - b);
      const average = prices.reduce((sum, p) => sum + p, 0) / prices.length;
      const median = prices[Math.floor(prices.length / 2)];
      const variance = prices.reduce((sum, p) => sum + Math.pow(p - average, 2), 0) / prices.length;
      const stdDev = Math.sqrt(variance);

      // 判断市场需求
      let marketDemand: 'high' | 'medium' | 'low';
      if (bids.length <= 2) {
        marketDemand = 'high';
      } else if (bids.length <= 5) {
        marketDemand = 'medium';
      } else {
        marketDemand = 'low';
      }

      return {
        competitorCount: bids.length,
        averageBidPrice: average,
        lowestBidPrice: prices[0],
        highestBidPrice: prices[prices.length - 1],
        medianBidPrice: median,
        priceStdDev: stdDev,
        marketDemand
      };
    } catch (error) {
      logger.warn('Failed to analyze market', { taskId, error });
      return {
        competitorCount: 0,
        averageBidPrice: 0,
        lowestBidPrice: 0,
        highestBidPrice: 0,
        medianBidPrice: 0,
        priceStdDev: 0,
        marketDemand: 'medium'
      };
    }
  }

  /**
   * 计算市场调整系数
   */
  private calculateMarketAdjustment(market: MarketAnalysis, basePrice: number): number {
    if (market.competitorCount === 0) {
      // 无竞争，可以溢价
      return 0.2;
    }

    const strategy = this.config.competitiveStrategy;

    switch (strategy) {
      case 'aggressive':
        // 激进策略：比最低价低5%，但保证利润
        const aggressivePrice = market.lowestBidPrice * 0.95;
        const minPrice = basePrice * (1 + this.config.minProfitMargin);
        const finalAggressivePrice = Math.max(aggressivePrice, minPrice);
        return (finalAggressivePrice / basePrice) - 1;

      case 'conservative':
        // 保守策略：比平均价高10%
        return (market.averageBidPrice * 1.1 / basePrice) - 1;

      case 'balanced':
      default:
        // 平衡策略：根据竞争程度调整
        if (market.competitorCount <= 2) {
          // 竞争少，略高于平均价
          return (market.averageBidPrice * 1.05 / basePrice) - 1;
        } else if (market.competitorCount <= 5) {
          // 竞争适中，接近平均价
          return (market.averageBidPrice / basePrice) - 1;
        } else {
          // 竞争激烈，略低于平均价但保证利润
          const targetPrice = market.averageBidPrice * 0.95;
          const minPrice = basePrice * (1 + this.config.minProfitMargin);
          return (Math.max(targetPrice, minPrice) / basePrice) - 1;
        }
    }
  }

  /**
   * 计算紧急程度调整
   */
  private calculateUrgencyAdjustment(task: Task): number {
    const deadline = new Date(task.expectedDeliveryAt);
    const now = new Date();
    const hoursUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilDeadline < 24) {
      return this.config.urgencyBonus;  // 24小时内，加30%
    } else if (hoursUntilDeadline < 48) {
      return this.config.urgencyBonus * 0.7;  // 48小时内，加21%
    } else if (hoursUntilDeadline < 72) {
      return this.config.urgencyBonus * 0.4;  // 72小时内，加12%
    }
    return 0;
  }

  /**
   * 计算客户关系调整
   */
  private async calculateClientAdjustment(clientId: string): Promise<number> {
    try {
      // 这里可以实现长期客户检测逻辑
      // 简化版本：假设所有客户都是新客户
      return 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * 计算定价置信度
   */
  private calculateConfidence(
    market: MarketAnalysis,
    analysisConfidence: number,
    finalPrice: number,
    minAcceptablePrice: number
  ): number {
    let confidence = analysisConfidence;

    // 市场竞争影响
    if (market.competitorCount === 0) {
      confidence *= 0.9;  // 无竞争，信息不足
    } else if (market.competitorCount > 10) {
      confidence *= 0.85; // 竞争太激烈
    } else {
      confidence *= 1.0;
    }

    // 价格合理性检查
    const margin = (finalPrice - minAcceptablePrice) / minAcceptablePrice;
    if (margin < 0.1) {
      confidence *= 0.8;  // 利润空间太小
    } else if (margin > 1.0) {
      confidence *= 0.9;  // 利润空间太大，可能不现实
    }

    return Math.min(1, Math.max(0, confidence));
  }

  /**
   * 更新定价配置
   */
  updateConfig(newConfig: Partial<SmartPricingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Pricing config updated', this.config);
  }

  /**
   * 获取当前配置
   */
  getConfig(): SmartPricingConfig {
    return { ...this.config };
  }
}
