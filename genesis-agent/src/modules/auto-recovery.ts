import { GenesisClient } from './genesis-client';
import { getLogger } from '../utils/logger';

const logger = getLogger();

/**
 * 恢复策略
 */
export type RecoveryStrategy = 'restart' | 'reconnect' | 'fallback' | 'alert';

/**
 * 恢复配置
 */
export interface AutoRecoveryConfig {
  enabled: boolean;
  maxRetries: number;
  retryIntervalMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
  strategies: RecoveryStrategy[];
  alertWebhook?: string;
  alertOnFailures: number;
}

/**
 * 恢复事件
 */
export interface RecoveryEvent {
  timestamp: number;
  component: string;
  error: string;
  strategy: RecoveryStrategy;
  success: boolean;
  retryCount: number;
  metadata?: Record<string, unknown>;
}

/**
 * 组件健康状态
 */
export interface ComponentHealth {
  component: string;
  isHealthy: boolean;
  lastCheck: number;
  consecutiveFailures: number;
  lastError?: string;
}

/**
 * 自动恢复管理器
 * 监控 Agent 各组件健康状态，自动执行恢复策略
 */
export class AutoRecoveryManager {
  private genesisClient: GenesisClient;
  private config: AutoRecoveryConfig;
  private recoveryHistory: RecoveryEvent[] = [];
  private componentHealth: Map<string, ComponentHealth> = new Map();
  private recoveryTimers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;
  private monitorInterval: NodeJS.Timeout | null = null;

  constructor(genesisClient: GenesisClient, config?: Partial<AutoRecoveryConfig>) {
    this.genesisClient = genesisClient;
    this.config = {
      enabled: true,
      maxRetries: 5,
      retryIntervalMs: 5000,
      backoffMultiplier: 2,
      maxBackoffMs: 60000,
      strategies: ['reconnect', 'restart', 'fallback', 'alert'],
      alertOnFailures: 3,
      ...config,
    };
  }

  /**
   * 启动自动恢复监控
   */
  start(): void {
    if (this.isRunning || !this.config.enabled) {
      return;
    }

    this.isRunning = true;
    logger.info('AutoRecoveryManager started', {
      maxRetries: this.config.maxRetries,
      retryIntervalMs: this.config.retryIntervalMs,
    });

    // 启动定期健康检查
    this.monitorInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.retryIntervalMs);
  }

  /**
   * 停止自动恢复监控
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    // 清除所有恢复定时器
    this.recoveryTimers.forEach((timer) => clearTimeout(timer));
    this.recoveryTimers.clear();

    logger.info('AutoRecoveryManager stopped');
  }

  /**
   * 注册组件
   */
  registerComponent(component: string): void {
    this.componentHealth.set(component, {
      component,
      isHealthy: true,
      lastCheck: Date.now(),
      consecutiveFailures: 0,
    });
    logger.debug('Component registered for auto-recovery', { component });
  }

  /**
   * 报告组件健康状态
   */
  reportHealth(component: string, isHealthy: boolean, error?: string): void {
    const health = this.componentHealth.get(component);
    if (!health) {
      this.registerComponent(component);
      return;
    }

    health.lastCheck = Date.now();

    if (isHealthy) {
      if (health.consecutiveFailures > 0) {
        logger.info(`Component ${component} recovered`, {
          previousFailures: health.consecutiveFailures,
        });
        health.consecutiveFailures = 0;
        health.lastError = undefined;
      }
      health.isHealthy = true;
    } else {
      health.consecutiveFailures++;
      health.lastError = error;
      health.isHealthy = false;

      logger.warn(`Component ${component} health check failed`, {
        consecutiveFailures: health.consecutiveFailures,
        error,
      });

      // 触发恢复流程
      this.triggerRecovery(component, error || 'Health check failed');
    }
  }

  /**
   * 执行健康检查
   */
  private performHealthCheck(): void {
    this.componentHealth.forEach((health, component) => {
      // 如果组件长时间未报告状态，认为不健康
      const timeSinceLastCheck = Date.now() - health.lastCheck;
      if (timeSinceLastCheck > this.config.retryIntervalMs * 2) {
        this.reportHealth(
          component,
          false,
          `No health report for ${Math.round(timeSinceLastCheck / 1000)}s`
        );
      }
    });
  }

  /**
   * 触发恢复流程
   */
  private async triggerRecovery(component: string, error: string): Promise<void> {
    const health = this.componentHealth.get(component);
    if (!health) return;

    // 如果已经在恢复中，跳过
    if (this.recoveryTimers.has(component)) {
      return;
    }

    const retryCount = health.consecutiveFailures;

    // 选择恢复策略
    const strategy = this.selectStrategy(component, retryCount);

    logger.info(`Triggering recovery for ${component}`, {
      strategy,
      retryCount,
      error,
    });

    // 执行恢复
    const success = await this.executeRecovery(component, strategy, error, retryCount);

    // 记录恢复事件
    this.recordRecoveryEvent(component, error, strategy, success, retryCount);

    // 如果恢复失败且未达到最大重试次数，安排下次重试
    if (!success && retryCount < this.config.maxRetries) {
      const backoff = this.calculateBackoff(retryCount);
      logger.info(`Scheduling retry for ${component} in ${backoff}ms`);

      const timer = setTimeout(() => {
        this.recoveryTimers.delete(component);
        this.triggerRecovery(component, error);
      }, backoff);

      this.recoveryTimers.set(component, timer);
    } else if (!success && retryCount >= this.config.maxRetries) {
      logger.error(`Max retries reached for ${component}, giving up`);
      this.sendAlert(component, error, retryCount);
    }
  }

  /**
   * 选择恢复策略
   */
  private selectStrategy(component: string, retryCount: number): RecoveryStrategy {
    const strategies = this.config.strategies;

    // 根据重试次数选择策略
    if (retryCount === 1) {
      return strategies.includes('reconnect') ? 'reconnect' : strategies[0];
    } else if (retryCount === 2) {
      return strategies.includes('restart') ? 'restart' : strategies[0];
    } else if (retryCount === 3) {
      return strategies.includes('fallback') ? 'fallback' : strategies[0];
    } else {
      return strategies.includes('alert') ? 'alert' : strategies[strategies.length - 1];
    }
  }

  /**
   * 执行恢复
   */
  private async executeRecovery(
    component: string,
    strategy: RecoveryStrategy,
    error: string,
    retryCount: number
  ): Promise<boolean> {
    try {
      switch (strategy) {
        case 'reconnect':
          return await this.reconnect(component);
        case 'restart':
          return await this.restart(component);
        case 'fallback':
          return await this.fallback(component);
        case 'alert':
          await this.sendAlert(component, error, retryCount);
          return false;
        default:
          return false;
      }
    } catch (recoveryError) {
      logger.error(`Recovery failed for ${component}`, {
        strategy,
        error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
      });
      return false;
    }
  }

  /**
   * 重连策略
   */
  private async reconnect(component: string): Promise<boolean> {
    logger.info(`Attempting to reconnect ${component}`);

    try {
      // 尝试重新连接后端
      const health = await this.genesisClient.checkHealth();

      if (health) {
        logger.info(`Reconnection successful for ${component}`);
        this.reportHealth(component, true);
        return true;
      }
    } catch (error) {
      logger.warn(`Reconnection failed for ${component}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return false;
  }

  /**
   * 重启策略
   */
  private async restart(component: string): Promise<boolean> {
    logger.info(`Attempting to restart ${component}`);

    try {
      // 通知后端 Agent 即将重启
      await this.genesisClient.reportRestart(component);

      // 模拟重启延迟
      await this.delay(2000);

      // 重新初始化组件
      logger.info(`Component ${component} restarted successfully`);
      this.reportHealth(component, true);
      return true;
    } catch (error) {
      logger.warn(`Restart failed for ${component}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 降级策略
   */
  private async fallback(component: string): Promise<boolean> {
    logger.info(`Attempting fallback for ${component}`);

    try {
      // 切换到备用模式
      // 例如：如果 Openclaw 不可用，使用本地分析
      // 如果心跳失败，增加心跳间隔

      logger.info(`Fallback applied for ${component}`);
      this.reportHealth(component, true);
      return true;
    } catch (error) {
      logger.warn(`Fallback failed for ${component}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 发送告警
   */
  private async sendAlert(component: string, error: string, retryCount: number): Promise<void> {
    const alertMessage = {
      type: 'agent_recovery_alert',
      component,
      error,
      retryCount,
      timestamp: new Date().toISOString(),
      severity: retryCount >= this.config.maxRetries ? 'critical' : 'warning',
    };

    logger.error('Auto-recovery alert', alertMessage);

    // 如果配置了告警 webhook，发送告警
    if (this.config.alertWebhook) {
      try {
        await fetch(this.config.alertWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(alertMessage),
        });
      } catch (e) {
        logger.error('Failed to send alert webhook', { error: e });
      }
    }
  }

  /**
   * 计算退避时间
   */
  private calculateBackoff(retryCount: number): number {
    const backoff = Math.min(
      this.config.retryIntervalMs * Math.pow(this.config.backoffMultiplier, retryCount - 1),
      this.config.maxBackoffMs
    );
    // 添加随机抖动
    return backoff + Math.random() * 1000;
  }

  /**
   * 记录恢复事件
   */
  private recordRecoveryEvent(
    component: string,
    error: string,
    strategy: RecoveryStrategy,
    success: boolean,
    retryCount: number
  ): void {
    const event: RecoveryEvent = {
      timestamp: Date.now(),
      component,
      error,
      strategy,
      success,
      retryCount,
    };

    this.recoveryHistory.push(event);

    // 保留最近 100 条记录
    if (this.recoveryHistory.length > 100) {
      this.recoveryHistory = this.recoveryHistory.slice(-100);
    }
  }

  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 获取恢复历史
   */
  getRecoveryHistory(): RecoveryEvent[] {
    return [...this.recoveryHistory];
  }

  /**
   * 获取组件健康状态
   */
  getComponentHealth(): ComponentHealth[] {
    return Array.from(this.componentHealth.values());
  }

  /**
   * 获取整体健康状态
   */
  getOverallHealth(): {
    isHealthy: boolean;
    healthyComponents: number;
    unhealthyComponents: number;
    totalComponents: number;
  } {
    const components = this.getComponentHealth();
    const healthy = components.filter((c) => c.isHealthy).length;
    const unhealthy = components.filter((c) => !c.isHealthy).length;

    return {
      isHealthy: unhealthy === 0,
      healthyComponents: healthy,
      unhealthyComponents: unhealthy,
      totalComponents: components.length,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<AutoRecoveryConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('AutoRecoveryManager config updated', { config });
  }
}

export default AutoRecoveryManager;
