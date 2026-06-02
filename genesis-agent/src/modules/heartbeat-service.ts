import { GenesisClient } from './genesis-client';
import { HeartbeatStatus } from '../types';
import { getLogger } from '../utils/logger';

const logger = getLogger();

/**
 * 心跳服务配置
 */
interface HeartbeatServiceConfig {
  genesisClient: GenesisClient;
  intervalMs: number;
  onStatusChange?: (status: HeartbeatStatus) => void;
  onFailure?: (consecutiveFailures: number) => void;
}

/**
 * 心跳服务
 * 负责定期向 Genesis 平台发送心跳，保持 Agent 在线状态
 */
export class HeartbeatService {
  private config: HeartbeatServiceConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private consecutiveFailures = 0;
  private lastStatus: HeartbeatStatus | null = null;

  constructor(config: HeartbeatServiceConfig) {
    this.config = config;
  }

  /**
   * 启动心跳服务
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Heartbeat service is already running');
      return;
    }

    this.isRunning = true;
    this.consecutiveFailures = 0;

    logger.info('Starting heartbeat service', {
      intervalMs: this.config.intervalMs,
    });

    // 立即发送一次心跳
    await this.sendHeartbeat();

    // 启动定时器
    this.timer = setInterval(() => {
      this.sendHeartbeat().catch((error) => {
        logger.error('Heartbeat error in interval', { error });
      });
    }, this.config.intervalMs);

    logger.info('Heartbeat service started successfully');
  }

  /**
   * 停止心跳服务
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

    logger.info('Heartbeat service stopped');
  }

  /**
   * 发送单次心跳
   */
  private async sendHeartbeat(): Promise<void> {
    try {
      const status = await this.config.genesisClient.sendHeartbeat();

      // 重置失败计数
      this.consecutiveFailures = 0;

      // 适配后端返回格式
      const heartbeatTime = status.lastHeartbeatAt || status.timestamp;

      // 检查状态是否变化
      if (this.lastStatus?.status !== status.status) {
        logger.info(`Agent status changed: ${this.lastStatus?.status} -> ${status.status}`, {
          status: status.status,
          lastHeartbeatAt: heartbeatTime,
        });

        // 触发状态变化回调
        this.config.onStatusChange?.(status);
      }

      this.lastStatus = status;

      logger.debug('Heartbeat sent successfully', {
        status: status.status,
        lastHeartbeatAt: heartbeatTime,
      });
    } catch (error) {
      this.consecutiveFailures++;

      logger.error('Heartbeat failed', {
        consecutiveFailures: this.consecutiveFailures,
        error: error instanceof Error ? error.message : String(error),
      });

      // 触发失败回调
      this.config.onFailure?.(this.consecutiveFailures);

      // 连续失败超过阈值，停止服务
      if (this.consecutiveFailures >= 5) {
        logger.error('Too many consecutive heartbeat failures, stopping service');
        this.stop();
        throw new Error('Heartbeat service stopped due to too many failures');
      }
    }
  }

  /**
   * 获取当前状态
   */
  getStatus(): HeartbeatStatus | null {
    return this.lastStatus;
  }

  /**
   * 是否正在运行
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * 获取连续失败次数
   */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }
}

export default HeartbeatService;
