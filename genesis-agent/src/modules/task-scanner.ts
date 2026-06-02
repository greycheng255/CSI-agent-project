import { GenesisClient } from './genesis-client';
import { SkillsManager } from './skills-manager';
import { Task, TaskStatus, ScanConfig, ScanResult, TaskAnalysis } from '../types';
import { getLogger } from '../utils/logger';

const logger = getLogger();

/**
 * 任务扫描器
 * 负责定期扫描 Genesis 平台的任务大厅，获取并筛选新任务
 * 实现 Agent 报价流程第 1-2 步：
 * 1. Agent 扫描任务大厅
 * 2. Agent 给 openclaw 安装技能，抓取任务描述和验收要求
 */
export class TaskScanner {
  private genesisClient: GenesisClient;
  private skillsManager: SkillsManager;
  private config: ScanConfig;
  private processedTasks = new Set<string>();
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private onTaskMatched?: (task: Task, analysis: TaskAnalysis) => void | Promise<void>;

  constructor(
    genesisClient: GenesisClient,
    skillsManager: SkillsManager,
    config: Partial<ScanConfig> = {},
    onTaskMatched?: (task: Task, analysis: TaskAnalysis) => void | Promise<void>
  ) {
    this.genesisClient = genesisClient;
    this.skillsManager = skillsManager;
    this.onTaskMatched = onTaskMatched;

    this.config = {
      intervalMs: 30000,
      batchSize: 20,
      maxRetries: 3,
      retryDelayMs: 1000,
      filters: {
        status: 'OPEN' as TaskStatus,
      },
      priorityRules: [
        { field: 'budget', weight: 0.4, direction: 'desc' },
        { field: 'deadline', weight: 0.3, direction: 'asc' },
        { field: 'complexity', weight: 0.3, direction: 'asc' },
      ],
      ...config,
    };
  }

  /**
   * 启动扫描服务
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Task scanner is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting task scanner', {
      intervalMs: this.config.intervalMs,
      batchSize: this.config.batchSize,
    });

    // 立即执行一次扫描（错误不中断启动）
    try {
      await this.scan();
    } catch (error) {
      logger.warn('Initial scan failed, but scanner will continue', { error });
    }

    // 启动定时器
    this.timer = setInterval(() => {
      this.scan().catch((error) => {
        logger.error('Scan error in interval', { error });
      });
    }, this.config.intervalMs);

    logger.info('Task scanner started successfully');
  }

  /**
   * 停止扫描服务
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    logger.info('Task scanner stopped');
  }

  /**
   * 执行单次扫描
   * 步骤 1: Agent 扫描任务大厅
   * 步骤 2: Agent 给 openclaw 安装技能，抓取任务描述和验收要求
   * 
   * 注意：允许重新处理已报价的任务，以便更新报价
   */
  async scan(): Promise<ScanResult> {
    const startTime = Date.now();

    try {
      logger.debug('Starting task scan...');
      console.log(`[TASK-FLOW] 开始扫描任务大厅 | timestamp=${new Date().toISOString()}`);

      // 步骤 1: 获取任务列表（Agent 扫描任务大厅）
      const tasks = await this.fetchTasks();
      console.log(`[TASK-FLOW] 扫描完成 | totalTasks=${tasks.length}`);

      // 步骤 2: 技能匹配和筛选（Agent 给 openclaw 安装技能，抓取任务描述和验收要求）
      const matchedTasks: Task[] = [];
      const matchedAnalyses: TaskAnalysis[] = [];

      // 获取置信度阈值
      const thresholds = this.skillsManager.getConfidenceThresholds();

      for (const task of tasks) {
        // 使用 SkillsManager 进行任务分析（抓取任务描述和验收要求）
        const analysis = this.skillsManager.analyzeTask(task);

        // 根据置信度决定如何处理
        if (analysis.confidence >= thresholds.accept) {
          // 高置信度 - 自动匹配
          matchedTasks.push(task);
          matchedAnalyses.push(analysis);

          // [追踪点] 任务匹配成功
          console.log(`[TASK-FLOW] 任务匹配成功 | taskId=${task.id} | title=${task.title} | confidence=${analysis.confidence.toFixed(2)}`);

          // 触发回调，进入报价流程（支持更新已有报价）
          this.onTaskMatched?.(task, analysis);

          logger.info('Task matched with high confidence - Starting quote process', {
            taskId: task.id,
            title: task.title,
            confidence: analysis.confidence,
            matchedSkills: analysis.requiredSkills,
            suggestedPrice: analysis.suggestedPrice,
            timeEstimate: analysis.timeEstimate,
            isReprocess: this.processedTasks.has(task.id),
          });
        } else if (analysis.confidence >= thresholds.review) {
          // 中等置信度 - 记录但可能需要人工审核
          logger.info('Task matched with medium confidence (needs review)', {
            taskId: task.id,
            title: task.title,
            confidence: analysis.confidence,
            matchedSkills: analysis.requiredSkills,
            suggestedPrice: analysis.suggestedPrice,
          });
        } else {
          // 低置信度 - 跳过
          logger.debug('Task skipped - low confidence', {
            taskId: task.id,
            title: task.title,
            confidence: analysis.confidence,
          });
        }

        // 标记为已处理（用于日志记录，不再用于过滤）
        this.processedTasks.add(task.id);
      }

      // 按优先级排序
      const sortedTasks = this.sortByPriority(matchedTasks);

      // 清理缓存
      this.cleanupCache();

      const scanTime = Date.now() - startTime;

      logger.info('Scan completed', {
        totalTasks: tasks.length,
        matchedTasks: matchedTasks.length,
        scanTimeMs: scanTime,
      });

      return {
        tasks: sortedTasks,
        totalCount: sortedTasks.length,
        scanTime,
      };
    } catch (error) {
      logger.error('Scan failed', { error });
      throw error;
    }
  }

  /**
   * 获取任务列表
   * 步骤 1: Agent 扫描任务大厅
   */
  private async fetchTasks(): Promise<Task[]> {
    return this.genesisClient.getTasks({
      status: this.config.filters.status,
      limit: this.config.batchSize,
      excludeIds: Array.from(this.processedTasks).slice(-1000),
    });
  }

  /**
   * 按优先级排序
   */
  private sortByPriority(tasks: Task[]): Task[] {
    return tasks.sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;

      for (const rule of this.config.priorityRules) {
        const valA = this.getFieldValue(a, rule.field);
        const valB = this.getFieldValue(b, rule.field);

        if (rule.direction === 'desc') {
          scoreA += valA * rule.weight;
          scoreB += valB * rule.weight;
        } else {
          // 对于升序，使用倒数
          scoreA += (1 / (valA || 1)) * rule.weight;
          scoreB += (1 / (valB || 1)) * rule.weight;
        }
      }

      return scoreB - scoreA;
    });
  }

  /**
   * 获取字段值
   */
  private getFieldValue(task: Task, field: string): number {
    switch (field) {
      case 'budget':
        return task.budgetCny;
      case 'deadline':
        return new Date(task.expectedDeliveryAt).getTime();
      case 'complexity':
        return task.complexity || 5;
      default:
        return 0;
    }
  }

  /**
   * 清理过期缓存
   */
  private cleanupCache(): void {
    const maxCacheSize = 10000;
    if (this.processedTasks.size > maxCacheSize) {
      const toRemove = this.processedTasks.size - maxCacheSize;
      const iterator = this.processedTasks.values();
      for (let i = 0; i < toRemove; i++) {
        const result = iterator.next();
        if (!result.done && result.value) {
          this.processedTasks.delete(result.value);
        }
      }
      logger.debug(`Cleaned up ${toRemove} cached task IDs`);
    }
  }

  /**
   * 是否正在运行
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * 获取已处理任务数量
   */
  getProcessedCount(): number {
    return this.processedTasks.size;
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.processedTasks.clear();
    logger.info('Task cache cleared');
  }
}

export default TaskScanner;
