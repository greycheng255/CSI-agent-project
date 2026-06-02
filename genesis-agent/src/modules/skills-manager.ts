import fs from 'fs';
import yaml from 'js-yaml';
import { Skill, MatchResult, Task, TaskAnalysis, PricingConfig } from '../types';
import { getLogger } from '../utils/logger';

const logger = getLogger();

/**
 * 技能管理器配置
 */
interface SkillsManagerConfig {
  configPath: string;
  autoReload?: boolean;
}

/**
 * 任务模式匹配规则
 */
interface TaskPattern {
  pattern: string;
  skillCategory: string;
  confidenceBoost: number;
}

/**
 * 技能管理器
 * 负责加载、管理和匹配 Agent 的技能
 * 支持通用任务处理能力
 */
export class SkillsManager {
  private skills: Skill[] = [];
  private taskPatterns: TaskPattern[] = [];
  private pricingConfig: PricingConfig = {
    baseRateCny: 50,
    complexityMultiplier: {
      simple: 1.0,
      moderate: 1.5,
      complex: 2.5,
      expert: 4.0,
    },
    urgencyMultiplier: {
      normal: 1.0,
      urgent: 1.3,
      emergency: 1.8,
    },
    minProfitMargin: 0.2,
    marketAdjustment: {
      enabled: true,
      maxDiscount: 0.15,
      minCompetitors: 2,
    },
  };
  private confidenceThresholds = {
    accept: 0.7,
    review: 0.5,
    reject: 0.3,
  };
  private config: SkillsManagerConfig;
  private watcher?: fs.FSWatcher;

  constructor(config: SkillsManagerConfig) {
    this.config = {
      autoReload: true,
      ...config,
    };
  }

  /**
   * 初始化技能管理器
   */
  async initialize(): Promise<void> {
    await this.loadSkills();

    if (this.config.autoReload) {
      this.startWatcher();
    }

    logger.info('Skills manager initialized', {
      skillCount: this.skills.length,
      patternCount: this.taskPatterns.length,
      skills: this.skills.map((s) => s.name),
    });
  }

  /**
   * 销毁技能管理器
   */
  destroy(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }

  /**
   * 从配置文件加载技能
   */
  private async loadSkills(): Promise<void> {
    try {
      if (!fs.existsSync(this.config.configPath)) {
        logger.warn(`Skills config not found at ${this.config.configPath}`);
        this.setupDefaultSkills();
        return;
      }

      const content = fs.readFileSync(this.config.configPath, 'utf-8');
      const config = yaml.load(content) as Record<string, unknown>;

      // 加载核心技能
      if (config.core_skills && Array.isArray(config.core_skills)) {
        this.skills = (config.core_skills as Skill[]).map((skill) => ({
          ...skill,
          keywords: skill.capabilities || [],
          level: 'expert',
          maxTaskComplexity: 10,
        }));
      }

      // 加载任务匹配模式
      if (config.task_patterns && Array.isArray(config.task_patterns)) {
        this.taskPatterns = (config.task_patterns as Array<Record<string, unknown>>).map((p) => ({
          pattern: p.pattern as string,
          skillCategory: (p.skill_category as string) || '',
          confidenceBoost: (p.confidence_boost as number) || 0.5,
        }));
      }

      // 加载报价策略
      if (config.pricing_strategy) {
        const ps = config.pricing_strategy as Record<string, unknown>;
        this.pricingConfig = {
          baseRateCny: (ps.base_rate_cny as number) || 50,
          complexityMultiplier: (ps.complexity_multiplier as Record<string, number>) || {
            simple: 1.0,
            moderate: 1.5,
            complex: 2.5,
            expert: 4.0,
          },
          urgencyMultiplier: (ps.urgency_multiplier as Record<string, number>) || {
            normal: 1.0,
            urgent: 1.3,
            emergency: 1.8,
          },
          minProfitMargin: (ps.min_profit_margin as number) || 0.2,
          marketAdjustment: (ps.market_adjustment as {
            enabled: boolean;
            maxDiscount: number;
            minCompetitors: number;
          }) || {
            enabled: true,
            maxDiscount: 0.15,
            minCompetitors: 2,
          },
        };
      }

      // 加载置信度阈值
      if (config.confidence_thresholds) {
        this.confidenceThresholds = config.confidence_thresholds as {
          accept: number;
          review: number;
          reject: number;
        };
      }

      logger.info(`Loaded ${this.skills.length} skills, ${this.taskPatterns.length} patterns from config`);
    } catch (error) {
      logger.error('Failed to load skills', { error });
      this.setupDefaultSkills();
    }
  }

  /**
   * 设置默认技能
   */
  private setupDefaultSkills(): void {
    this.skills = [
      {
        name: 'universal_task_handler',
        description: '通用任务处理能力',
        keywords: ['任务处理', '开发', '编程', '脚本', '数据处理', '自动化'],
        level: 'expert',
        maxTaskComplexity: 10,
      },
    ];
    this.taskPatterns = [
      {
        pattern: '.*',
        skillCategory: 'universal',
        confidenceBoost: 0.8,
      },
    ];
  }

  /**
   * 启动文件监听器
   */
  private startWatcher(): void {
    try {
      this.watcher = fs.watch(this.config.configPath, (eventType) => {
        if (eventType === 'change') {
          logger.info('Skills config changed, reloading...');
          this.loadSkills().catch((error) => {
            logger.error('Failed to reload skills', { error });
          });
        }
      });

      logger.info('Started skills config watcher');
    } catch (error) {
      logger.error('Failed to start skills watcher', { error });
    }
  }

  /**
   * 获取所有技能
   */
  getSkills(): Skill[] {
    return [...this.skills];
  }

  /**
   * 匹配技能 - 基于任务描述进行智能匹配
   * @param taskDescription 任务描述
   * @returns 匹配结果列表，按匹配度降序排列
   */
  matchSkills(taskDescription: string): MatchResult[] {
    if (!taskDescription) {
      return [];
    }

    const results: MatchResult[] = [];
    const lowerDescription = taskDescription.toLowerCase();

    // 1. 基于正则模式匹配
    for (const pattern of this.taskPatterns) {
      try {
        const regex = new RegExp(pattern.pattern, 'i');
        if (regex.test(taskDescription)) {
          const confidence = pattern.confidenceBoost;
          results.push({
            skill: {
              name: pattern.skillCategory,
              description: `Pattern match: ${pattern.pattern}`,
              keywords: [],
              level: 'expert',
              maxTaskComplexity: 10,
            },
            matchScore: confidence,
            matchedKeywords: [pattern.pattern],
            confidence,
          });
        }
      } catch (e) {
        logger.warn(`Invalid regex pattern: ${pattern.pattern}`);
      }
    }

    // 2. 基于关键词匹配
    for (const skill of this.skills) {
      const matched = skill.keywords.filter((k) => lowerDescription.includes(k.toLowerCase()));

      if (matched.length > 0) {
        const matchScore = matched.length / skill.keywords.length;
        const confidence = this.calculateConfidence(lowerDescription, skill, matchScore);

        results.push({
          skill,
          matchScore,
          matchedKeywords: matched,
          confidence,
        });
      }
    }

    // 3. 通用匹配 - 如果没有任何匹配，给予基础置信度 0.8
    if (results.length === 0) {
      results.push({
        skill: {
          name: 'universal_handler',
          description: '通用任务处理能力',
          keywords: ['通用'],
          level: 'expert',
          maxTaskComplexity: 10,
        },
        matchScore: 0.8,
        matchedKeywords: ['通用匹配'],
        confidence: 0.8,
      });
    }

    // 按匹配度降序排列
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 分析任务 - 全面的任务分析
   * @param task 任务对象
   * @returns 任务分析结果
   */
  analyzeTask(task: Task): TaskAnalysis {
    const description = task.description || '';
    const title = task.title || '';
    const fullText = `${title} ${description}`;

    // 1. 技能匹配
    const skillMatches = this.matchSkills(fullText);
    const bestMatch = skillMatches[0];

    // 2. 提取关键词
    const extractedKeywords = this.extractKeywords(fullText);

    // 3. 评估复杂度
    const estimatedComplexity = this.estimateComplexity(task, skillMatches);

    // 4. 预估工时
    const timeEstimate = this.estimateTime(task, estimatedComplexity);

    // 5. 计算置信度
    const confidence = bestMatch ? bestMatch.confidence : 0.8;

    // 6. 生成报价
    const suggestedPrice = this.calculatePrice(task, timeEstimate, estimatedComplexity);

    return {
      taskId: task.id,
      title: task.title,
      description: task.description,
      extractedKeywords,
      estimatedComplexity,
      requiredSkills: skillMatches.map((m) => m.skill.name),
      timeEstimate,
      confidence,
      suggestedPrice,
    };
  }

  /**
   * 计算置信度
   */
  private calculateConfidence(description: string, skill: Skill, matchScore: number): number {
    // 基础匹配分数
    let confidence = matchScore;

    // 技能等级加成
    const levelBonus: Record<string, number> = {
      beginner: 0.05,
      intermediate: 0.1,
      advanced: 0.15,
      expert: 0.2,
    };
    confidence += levelBonus[skill.level] || 0;

    // 描述长度因子（描述越长，置信度越高）
    const lengthFactor = Math.min(description.length / 100, 0.1);
    confidence += lengthFactor;

    // 确保在合理范围内
    return Math.min(Math.max(confidence, 0), 1);
  }

  /**
   * 从任务描述中提取关键词
   */
  private extractKeywords(description: string): string[] {
    const keywords: string[] = [];

    // 技术栈关键词
    const techPatterns = [
      /python|python3/gi,
      /javascript|js|node\.?js/gi,
      /typescript|ts/gi,
      /java/gi,
      /go|golang/gi,
      /rust/gi,
      /php/gi,
      /ruby/gi,
      /c\+\+|cpp/gi,
      /c#/gi,
      /sql|mysql|postgresql|mongodb/gi,
      /docker|kubernetes|k8s/gi,
      /aws|azure|gcp|云/gi,
      /ai|人工智能|机器学习|深度学习/gi,
      /爬虫|抓取|scraping/gi,
      /api|接口/gi,
      /web|网站|网页/gi,
      /app|应用/gi,
      /数据|data/gi,
      /自动化|automatic/gi,
    ];

    for (const pattern of techPatterns) {
      const matches = description.match(pattern);
      if (matches) {
        keywords.push(...matches);
      }
    }

    return [...new Set(keywords)].slice(0, 10);
  }

  /**
   * 评估任务复杂度
   */
  private estimateComplexity(task: Task, skillMatches: MatchResult[]): 'simple' | 'moderate' | 'complex' | 'expert' {
    const description = task.description || '';
    let complexityScore = 0;

    // 基于描述长度
    complexityScore += Math.min(description.length / 500, 2);

    // 基于关键词复杂度
    const complexIndicators = ['架构', '设计', '优化', '算法', '模型', '系统', '平台', '框架'];
    for (const indicator of complexIndicators) {
      if (description.includes(indicator)) {
        complexityScore += 0.5;
      }
    }

    // 基于技能匹配度
    if (skillMatches.length > 0) {
      complexityScore += skillMatches[0].confidence;
    }

    // 基于预算（如果预算高，可能复杂度也高）
    if (task.budgetCny > 1000) {
      complexityScore += 1;
    }

    if (complexityScore < 2) return 'simple';
    if (complexityScore < 4) return 'moderate';
    if (complexityScore < 6) return 'complex';
    return 'expert';
  }

  /**
   * 预估工时（小时）
   */
  private estimateTime(task: Task, complexity: string): number {
    const baseTime: Record<string, number> = {
      simple: 2,
      moderate: 6,
      complex: 15,
      expert: 30,
    };

    let time = baseTime[complexity] || 4;

    // 根据描述调整
    const description = task.description || '';
    if (description.includes('简单') || description.includes('简易')) {
      time *= 0.7;
    }
    if (description.includes('复杂') || description.includes('困难')) {
      time *= 1.5;
    }

    // 根据交付时间调整
    if (task.expectedDeliveryAt) {
      const days = Math.ceil((new Date(task.expectedDeliveryAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (days < 3) {
        time *= 0.8; // 紧急任务可能范围缩小
      }
    }

    return Math.max(Math.round(time), 1);
  }

  /**
   * 计算建议报价
   */
  private calculatePrice(task: Task, timeEstimate: number, complexity: string): number {
    const baseRate = this.pricingConfig.baseRateCny;
    const complexityMult = this.pricingConfig.complexityMultiplier[complexity] || 1;

    // 基础价格
    let price = baseRate * timeEstimate * complexityMult;

    // 应用利润率
    price = price * (1 + this.pricingConfig.minProfitMargin);

    // 确保不低于预算的某个比例
    if (task.budgetCny > 0) {
      const minPrice = task.budgetCny * 0.3; // 最低接受预算的30%
      const maxPrice = task.budgetCny * 0.95; // 最高不超过预算的95%
      price = Math.max(price, minPrice);
      price = Math.min(price, maxPrice);
    }

    return Math.round(price);
  }

  /**
   * 获取报价配置
   */
  getPricingConfig(): PricingConfig {
    return { ...this.pricingConfig };
  }

  /**
   * 获取置信度阈值
   */
  getConfidenceThresholds(): { accept: number; review: number; reject: number } {
    return { ...this.confidenceThresholds };
  }
}
