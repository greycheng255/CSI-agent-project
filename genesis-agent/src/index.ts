import {
  GenesisClient,
  HeartbeatService,
  SkillsManager,
  TaskScanner,
  QuoteManager,
  WebhookHandler,
  AutoRecoveryManager,
} from './modules';
import { initLogger, getLogger } from './utils/logger';
import { NetworkDiagnostic } from './utils/network-diagnostic';
import { Task, TaskAnalysis } from './types';

// 先初始化 logger，确保能读取到 AGENT_ID
initLogger({
  agentId: process.env.AGENT_ID || 'unknown',
  level: process.env.LOG_LEVEL || 'info',
});
const logger = getLogger();

/**
 * Genesis Agent 主类
 * 最简架构：
 * - 心跳服务 (维持在线)
 * - 任务扫描器 (发现任务)
 * - 技能管理器 (技能配置)
 * - 报价管理器 (分析+报价+执行)
 * - Webhook 处理器 (接收通知)
 * - 自动恢复管理器 (故障自动恢复)
 */
class GenesisAgent {
  private genesisClient?: GenesisClient;
  private heartbeatService?: HeartbeatService;
  private skillsManager?: SkillsManager;
  private taskScanner?: TaskScanner;
  private quoteManager?: QuoteManager;
  private webhookHandler?: WebhookHandler;
  private autoRecovery?: AutoRecoveryManager;
  private isRunning = false;

  // 配置
  private agentId: string;
  private ownerToken: string;
  private agentApiKey: string;
  private genesisApi: string;
  private webhookUrl: string;

  constructor() {
    this.agentId = process.env.AGENT_ID || '';
    // OWNER_TOKEN 支持 MARKETPLACE_PAT / PAT 别名（Marketplace 个人中心生成的 PAT）
    this.ownerToken =
      process.env.OWNER_TOKEN ||
      process.env.MARKETPLACE_PAT ||
      process.env.PAT ||
      '';
    this.agentApiKey = process.env.AGENT_API_KEY || '';
    this.genesisApi = process.env.GENESIS_API || 'http://genesis-backend.genesis.svc.cluster.local:4000';
    this.webhookUrl = process.env.AGENT_WEBHOOK_URL || '';
  }

  /**
   * 初始化 Agent
   */
  async initialize(): Promise<void> {
    try {
      // 日志已在模块加载时初始化，这里更新 agentId
      logger.info('Initializing Genesis Agent...', {
        agentId: this.agentId,
        genesisApi: this.genesisApi,
      });

      // 1. 网络诊断
      const networkDiagnostic = new NetworkDiagnostic(this.genesisApi);
      const diagnosticResult = await networkDiagnostic.runDiagnostics();

      console.log('\n' + '='.repeat(50));
      console.log('网络诊断结果');
      console.log('='.repeat(50));
      console.log(networkDiagnostic.getStatusSummary(diagnosticResult));

      if (!diagnosticResult.httpReachable) {
        console.log('\n可能的解决方案:');
        networkDiagnostic.getRecommendations(diagnosticResult).forEach(rec => {
          console.log(rec);
        });
        console.log('='.repeat(50) + '\n');

        // 如果完全无法连接，给出警告但继续尝试（可能有间歇性问题）
        logger.warn('Network connectivity issues detected, but continuing initialization...');
      }

      // 2. 创建 Genesis API 客户端
      this.genesisClient = new GenesisClient({
        baseUrl: this.genesisApi,
        agentId: this.agentId,
        ownerToken: this.ownerToken,
        agentApiKey: this.agentApiKey,
      });

      // 3. 初始化技能管理器
      this.skillsManager = new SkillsManager({
        configPath: './src/config/skills.yaml',
        autoReload: true,
      });
      await this.skillsManager.initialize();

      // 4. 自动注册/更新 Agent（Pod 重启后保持 AGENT_ID）
      await this.registerOrUpdateAgent();

      // 5. 创建报价管理器（整合分析+报价+执行）
      this.quoteManager = new QuoteManager(
        this.skillsManager,
        this.genesisClient,
        this.agentId,
        this.webhookUrl,
        this.genesisApi,
        this.agentApiKey
      );

      // 6. 创建心跳服务（必须在 registerOrUpdateAgent 之后，确保 agentId 已更新）
      this.heartbeatService = new HeartbeatService({
        genesisClient: this.genesisClient,
        intervalMs: Number(process.env.HEARTBEAT_INTERVAL) || 30000,
        onStatusChange: (status) => {
          logger.info('Agent status changed', { status: status.status });
        },
        onFailure: (failures) => {
          logger.warn('Heartbeat failures', { consecutiveFailures: failures });
        },
      });

      // 7. 创建任务扫描器
      this.taskScanner = new TaskScanner(
        this.genesisClient,
        this.skillsManager,
        {
          intervalMs: Number(process.env.SCAN_INTERVAL) || 30000,
          batchSize: 20,
        },
        this.onTaskMatched.bind(this)
      );

      // 8. 创建 Webhook 处理器
      this.webhookHandler = new WebhookHandler(
        this.quoteManager,
        Number(process.env.WEBHOOK_PORT) || 3000
      );

      // 9. 创建自动恢复管理器
      this.autoRecovery = new AutoRecoveryManager(this.genesisClient, {
        enabled: process.env.AUTO_RECOVERY_ENABLED !== 'false',
        maxRetries: Number(process.env.AUTO_RECOVERY_MAX_RETRIES) || 5,
        retryIntervalMs: Number(process.env.AUTO_RECOVERY_INTERVAL) || 10000,
        alertOnFailures: Number(process.env.AUTO_RECOVERY_ALERT_AFTER) || 3,
      });

      // 注册各组件到自动恢复管理器
      this.autoRecovery.registerComponent('heartbeat');
      this.autoRecovery.registerComponent('taskScanner');
      this.autoRecovery.registerComponent('webhook');
      this.autoRecovery.registerComponent('quoteManager');

      logger.info('Genesis Agent initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Genesis Agent', { error });
      throw error;
    }
  }

  /**
   * 启动 Agent
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Agent is already running');
      return;
    }

    try {
      logger.info('Starting Genesis Agent...');

      // 1. 启动心跳服务
      await this.heartbeatService?.start();

      // 2. 启动任务扫描器
      await this.taskScanner?.start();

      // 3. 启动 Webhook 服务器
      await this.webhookHandler?.start();

      // 4. 启动自动恢复管理器
      this.autoRecovery?.start();

      this.isRunning = true;

      logger.info('Genesis Agent started successfully');
      logger.info('Agent is now scanning for tasks and listening for webhooks...');

      // 4. 设置优雅关闭
      this.setupGracefulShutdown();
    } catch (error) {
      logger.error('Failed to start Genesis Agent', { error });
      throw error;
    }
  }

  /**
   * 停止 Agent
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping Genesis Agent...');

    this.taskScanner?.stop();
    this.heartbeatService?.stop();
    this.webhookHandler?.stop();
    this.autoRecovery?.stop();
    this.skillsManager?.destroy();

    this.isRunning = false;

    logger.info('Genesis Agent stopped');
  }

  /**
   * 任务匹配回调
   * 触发报价流程
   */
  private async onTaskMatched(task: Task, analysis: TaskAnalysis): Promise<void> {
    logger.info('Task matched - Starting quote process', {
      taskId: task.id,
      title: task.title,
      confidence: analysis.confidence,
    });

    try {
      const bid = await this.quoteManager?.processMatchedTask(task, analysis);

      if (bid) {
        logger.info('Quote process completed', {
          taskId: task.id,
          bidId: bid.id,
          price: bid.priceCny,
        });
      }
    } catch (error) {
      logger.error('Failed to process matched task', {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 设置优雅关闭
   */
  private setupGracefulShutdown(): void {
    const shutdown = (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      this.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error });
      this.stop();
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', { reason });
    });
  }

  /**
   * 获取运行状态
   */
  getStatus(): {
    isRunning: boolean;
    heartbeatActive: boolean;
    scannerActive: boolean;
    skillCount: number;
  } {
    return {
      isRunning: this.isRunning,
      heartbeatActive: this.heartbeatService?.isActive() || false,
      scannerActive: this.taskScanner?.isActive() || false,
      skillCount: this.skillsManager?.getSkills().length || 0,
    };
  }

  /**
   * 注册或更新 Agent（Pod 重启后保持 AGENT_ID）
   */
  private async registerOrUpdateAgent(): Promise<void> {
    // 生成或获取持久化标识
    const externalId = process.env.EXTERNAL_ID || this.generateExternalId();
    const podName = process.env.HOSTNAME || '';
    const podIp = process.env.POD_IP || '';

    if (!externalId) {
      logger.warn('No EXTERNAL_ID configured, skipping auto-registration');
      return;
    }

    try {
      // 构建 webhook URL
      const webhookPort = process.env.WEBHOOK_PORT || '3000';
      const webhookUrl = process.env.AGENT_WEBHOOK_URL || `http://${podIp}:${webhookPort}/webhook`;

      logger.info('Registering/updating agent with externalId', { externalId, podName });

      // 调用 upsert API
      const response = await this.genesisClient!.upsertAgent({
        externalId,
        name: process.env.AGENT_NAME || externalId,
        webhookUrl,
        podName,
        agentMode: (process.env.AGENT_MODE as 'kubernetes' | 'external') || 'kubernetes',
        skills: this.skillsManager!.getSkills().map(s => s.name),
        description: process.env.AGENT_DESCRIPTION || `Genesis Agent (${externalId})`,
      });

      // 更新本地 AGENT_ID
      if (response.id) {
        this.agentId = response.id;
        // 更新 genesisClient 的 agentId
        this.genesisClient!.updateAgentId(this.agentId);
        logger.info('Agent registered/updated successfully', {
          agentId: this.agentId,
          externalId: response.externalId,
          agentMode: response.agentMode,
        });
      }
    } catch (error) {
      logger.error('Failed to register/update agent', { error, externalId });
      // 继续运行，使用环境变量中的 AGENT_ID
      logger.info('Continuing with existing AGENT_ID from environment', { agentId: this.agentId });
    }
  }

  /**
   * 生成 externalId（从 Pod 名称提取基础标识）
   * openclaw-oc-grey-6e28-7fd8bc7659-5g6gt → openclaw-oc-grey-6e28
   */
  private generateExternalId(): string {
    const hostname = process.env.HOSTNAME || '';
    if (!hostname) return '';

    // 移除最后的随机后缀（5位或更多字符）
    // openclaw-oc-grey-6e28-7fd8bc7659-5g6gt → openclaw-oc-grey-6e28
    return hostname.replace(/-[a-z0-9]{5,}$/i, '');
  }
}

/**
 * 主入口
 */
async function main(): Promise<void> {
  const agent = new GenesisAgent();

  try {
    await agent.initialize();
    await agent.start();

    // 定期输出状态
    setInterval(() => {
      const status = agent.getStatus();
      getLogger().info('Agent status', status);
    }, 60000);
  } catch (error) {
    getLogger().error('Fatal error', { error });
    process.exit(1);
  }
}

// 启动
main();

export { GenesisAgent };
export default GenesisAgent;
