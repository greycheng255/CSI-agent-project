import { getLogger } from '../utils/logger';
import { GenesisClient } from './genesis-client';

const logger = getLogger();

/**
 * 性能指标
 */
export interface PerformanceMetrics {
  timestamp: number;
  cpuUsage: number;
  memoryUsage: number;
  activeTasks: number;
  pendingQuotes: number;
  successRate: number;
  avgResponseTime: number;
  errorRate: number;
}

/**
 * 业务指标
 */
export interface BusinessMetrics {
  timestamp: number;
  tasksScanned: number;
  tasksAssessed?: number;
  tasksQuoted: number;
  bidsSubmitted: number;
  bidsAccepted: number;
  ordersExecuted: number;
  ordersCompleted: number;
  totalRevenue: number;
  totalProfit: number;
  winRate: number;
}

/**
 * 告警规则
 */
export interface AlertRule {
  name: string;
  metric: string;
  threshold: number;
  operator: '>' | '<' | '>=' | '<=' | '==';
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

/**
 * Agent 监控器
 * 实时监控 Agent 性能、业务指标，并提供告警功能
 */
export class AgentMonitor {
  private genesisClient: GenesisClient;
  private agentId: string;
  private metricsHistory: PerformanceMetrics[] = [];
  private businessMetricsHistory: BusinessMetrics[] = [];
  private alertRules: AlertRule[] = [];
  private isMonitoring = false;
  private monitorInterval: NodeJS.Timeout | null = null;
  private alertCallbacks: Array<(alert: AlertRule, value: number) => void> = [];

  constructor(genesisClient: GenesisClient, agentId: string) {
    this.genesisClient = genesisClient;
    this.agentId = agentId;
    this.setupDefaultAlertRules();
  }

  /**
   * 设置默认告警规则
   */
  private setupDefaultAlertRules(): void {
    this.alertRules = [
      {
        name: 'high_cpu_usage',
        metric: 'cpuUsage',
        threshold: 80,
        operator: '>',
        severity: 'warning',
        message: 'CPU 使用率过高: {value}%'
      },
      {
        name: 'high_memory_usage',
        metric: 'memoryUsage',
        threshold: 85,
        operator: '>',
        severity: 'warning',
        message: '内存使用率过高: {value}%'
      },
      {
        name: 'high_error_rate',
        metric: 'errorRate',
        threshold: 10,
        operator: '>',
        severity: 'critical',
        message: '错误率过高: {value}%'
      },
      {
        name: 'low_success_rate',
        metric: 'successRate',
        threshold: 80,
        operator: '<',
        severity: 'warning',
        message: '成功率过低: {value}%'
      },
      {
        name: 'slow_response',
        metric: 'avgResponseTime',
        threshold: 5000,
        operator: '>',
        severity: 'warning',
        message: '响应时间过长: {value}ms'
      }
    ];
  }

  /**
   * 启动监控
   */
  startMonitoring(intervalMs: number = 60000): void {
    if (this.isMonitoring) {
      logger.warn('Monitor is already running');
      return;
    }

    this.isMonitoring = true;
    logger.info('Starting agent monitor', { intervalMs });

    // 立即收集一次指标
    this.collectMetrics().catch(error => {
      logger.error('Initial metrics collection failed', { error });
    });

    // 定期收集指标
    this.monitorInterval = setInterval(() => {
      this.collectMetrics().catch(error => {
        logger.error('Metrics collection failed', { error });
      });
    }, intervalMs);
  }

  /**
   * 停止监控
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    logger.info('Agent monitor stopped');
  }

  /**
   * 收集性能指标
   */
  private async collectMetrics(): Promise<void> {
    try {
      const metrics: PerformanceMetrics = {
        timestamp: Date.now(),
        cpuUsage: await this.getCPUUsage(),
        memoryUsage: this.getMemoryUsage(),
        activeTasks: this.getActiveTasks(),
        pendingQuotes: this.getPendingQuotes(),
        successRate: this.calculateSuccessRate(),
        avgResponseTime: this.calculateAvgResponseTime(),
        errorRate: this.calculateErrorRate()
      };

      this.metricsHistory.push(metrics);

      // 保留最近100条记录
      if (this.metricsHistory.length > 100) {
        this.metricsHistory.shift();
      }

      // 检查告警
      this.checkAlerts(metrics);

      logger.debug('Metrics collected', metrics);
    } catch (error) {
      logger.error('Failed to collect metrics', { error });
    }
  }

  /**
   * 获取 CPU 使用率
   */
  private async getCPUUsage(): Promise<number> {
    // 简化的 CPU 使用率计算
    // 实际实现可以使用 pidusage 等库
    return 0;
  }

  /**
   * 获取内存使用率
   */
  private getMemoryUsage(): number {
    const used = process.memoryUsage();
    const total = require('os').totalmem();
    return Math.round((used.heapUsed / total) * 100);
  }

  /**
   * 获取活跃任务数
   */
  private getActiveTasks(): number {
    // 需要从外部传入或使用全局状态
    return 0;
  }

  /**
   * 获取待处理报价数
   */
  private getPendingQuotes(): number {
    // 需要从外部传入或使用全局状态
    return 0;
  }

  /**
   * 计算成功率
   */
  private calculateSuccessRate(): number {
    const recent = this.metricsHistory.slice(-10);
    if (recent.length === 0) return 100;
    // 简化的计算
    return 95;
  }

  /**
   * 计算平均响应时间
   */
  private calculateAvgResponseTime(): number {
    const recent = this.metricsHistory.slice(-10);
    if (recent.length === 0) return 0;
    const sum = recent.reduce((acc, m) => acc + m.avgResponseTime, 0);
    return Math.round(sum / recent.length);
  }

  /**
   * 计算错误率
   */
  private calculateErrorRate(): number {
    const recent = this.metricsHistory.slice(-10);
    if (recent.length === 0) return 0;
    // 简化的计算
    return 2;
  }

  /**
   * 检查告警
   */
  private checkAlerts(metrics: PerformanceMetrics): void {
    for (const rule of this.alertRules) {
      const value = (metrics as any)[rule.metric];
      if (value === undefined) continue;

      let triggered = false;
      switch (rule.operator) {
        case '>':
          triggered = value > rule.threshold;
          break;
        case '<':
          triggered = value < rule.threshold;
          break;
        case '>=':
          triggered = value >= rule.threshold;
          break;
        case '<=':
          triggered = value <= rule.threshold;
          break;
        case '==':
          triggered = value === rule.threshold;
          break;
      }

      if (triggered) {
        const message = rule.message.replace('{value}', value.toString());
        this.triggerAlert(rule, value, message);
      }
    }
  }

  /**
   * 触发告警
   */
  private triggerAlert(rule: AlertRule, value: number, message: string): void {
    logger.warn(`[${rule.severity.toUpperCase()}] ${message}`, {
      rule: rule.name,
      metric: rule.metric,
      value,
      threshold: rule.threshold
    });

    // 调用注册的回调
    for (const callback of this.alertCallbacks) {
      try {
        callback(rule, value);
      } catch (error) {
        logger.error('Alert callback failed', { error });
      }
    }
  }

  /**
   * 记录业务指标
   */
  recordBusinessMetrics(metrics: Partial<BusinessMetrics>): void {
    const fullMetrics: BusinessMetrics = {
      timestamp: Date.now(),
      tasksScanned: metrics.tasksScanned || 0,
      tasksQuoted: metrics.tasksQuoted || 0,
      bidsSubmitted: metrics.bidsSubmitted || 0,
      bidsAccepted: metrics.bidsAccepted || 0,
      ordersExecuted: metrics.ordersExecuted || 0,
      ordersCompleted: metrics.ordersCompleted || 0,
      totalRevenue: metrics.totalRevenue || 0,
      totalProfit: metrics.totalProfit || 0,
      winRate: metrics.winRate || 0
    };

    this.businessMetricsHistory.push(fullMetrics);

    // 保留最近1000条记录
    if (this.businessMetricsHistory.length > 1000) {
      this.businessMetricsHistory.shift();
    }

    logger.info('Business metrics recorded', fullMetrics);
  }

  /**
   * 获取性能报告
   */
  getPerformanceReport(timeRange: '1h' | '24h' | '7d' = '24h'): {
    avgCpu: number;
    avgMemory: number;
    avgSuccessRate: number;
    avgResponseTime: number;
    peakCpu: number;
    peakMemory: number;
  } {
    const now = Date.now();
    const ranges: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000
    };
    const cutoff = now - ranges[timeRange];

    const recent = this.metricsHistory.filter(m => m.timestamp > cutoff);

    if (recent.length === 0) {
      return {
        avgCpu: 0,
        avgMemory: 0,
        avgSuccessRate: 0,
        avgResponseTime: 0,
        peakCpu: 0,
        peakMemory: 0
      };
    }

    const avgCpu = recent.reduce((sum, m) => sum + m.cpuUsage, 0) / recent.length;
    const avgMemory = recent.reduce((sum, m) => sum + m.memoryUsage, 0) / recent.length;
    const avgSuccessRate = recent.reduce((sum, m) => sum + m.successRate, 0) / recent.length;
    const avgResponseTime = recent.reduce((sum, m) => sum + m.avgResponseTime, 0) / recent.length;
    const peakCpu = Math.max(...recent.map(m => m.cpuUsage));
    const peakMemory = Math.max(...recent.map(m => m.memoryUsage));

    return {
      avgCpu: Math.round(avgCpu),
      avgMemory: Math.round(avgMemory),
      avgSuccessRate: Math.round(avgSuccessRate),
      avgResponseTime: Math.round(avgResponseTime),
      peakCpu,
      peakMemory
    };
  }

  /**
   * 获取业务报告
   */
  getBusinessReport(timeRange: '1d' | '7d' | '30d' = '7d'): {
    totalTasksScanned: number;
    totalBidsSubmitted: number;
    totalBidsAccepted: number;
    totalOrdersCompleted: number;
    totalRevenue: number;
    totalProfit: number;
    avgWinRate: number;
  } {
    const now = Date.now();
    const ranges: Record<string, number> = {
      '1d': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    const cutoff = now - ranges[timeRange];

    const recent = this.businessMetricsHistory.filter(m => m.timestamp > cutoff);

    if (recent.length === 0) {
      return {
        totalTasksScanned: 0,
        totalBidsSubmitted: 0,
        totalBidsAccepted: 0,
        totalOrdersCompleted: 0,
        totalRevenue: 0,
        totalProfit: 0,
        avgWinRate: 0
      };
    }

    const latest = recent[recent.length - 1];
    const earliest = recent[0];

    return {
      totalTasksScanned: latest.tasksScanned - earliest.tasksScanned,
      totalBidsSubmitted: latest.bidsSubmitted - earliest.bidsSubmitted,
      totalBidsAccepted: latest.bidsAccepted - earliest.bidsAccepted,
      totalOrdersCompleted: latest.ordersCompleted - earliest.ordersCompleted,
      totalRevenue: latest.totalRevenue - earliest.totalRevenue,
      totalProfit: latest.totalProfit - earliest.totalProfit,
      avgWinRate: Math.round(recent.reduce((sum, m) => sum + m.winRate, 0) / recent.length)
    };
  }

  /**
   * 注册告警回调
   */
  onAlert(callback: (alert: AlertRule, value: number) => void): void {
    this.alertCallbacks.push(callback);
  }

  /**
   * 添加自定义告警规则
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.push(rule);
    logger.info('Alert rule added', rule);
  }

  /**
   * 获取历史指标
   */
  getMetricsHistory(): PerformanceMetrics[] {
    return [...this.metricsHistory];
  }

  /**
   * 获取业务历史
   */
  getBusinessHistory(): BusinessMetrics[] {
    return [...this.businessMetricsHistory];
  }
}
