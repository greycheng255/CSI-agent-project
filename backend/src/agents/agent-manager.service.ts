import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent, AgentStatus } from './entities/agent.entity';
import { User } from '../users/entities/user.entity';
import { randomBytes } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

interface AgentDeploymentConfig {
  userId: string;
  agentId: string;
  externalId: string;
  apiKey: string;
  ownerToken: string;
  userPhone?: string;
  openclawInstance?: string;
  resources?: {
    memory?: string;
    cpu?: string;
  };
}

// K8s Pod 类型定义
interface K8sPod {
  metadata: {
    name: string;
    labels?: {
      userId?: string;
      agentId?: string;
    };
    creationTimestamp?: string;
  };
  status: {
    phase: string;
    podIP?: string;
    containerStatuses?: Array<{
      ready?: boolean;
      restartCount?: number;
      state?: {
        waiting?: {
          message?: string;
        };
      };
    }>;
  };
}

interface K8sPodList {
  items: K8sPod[];
}

interface AgentStatusInfo {
  agentId: string;
  status: AgentStatus;
  podName?: string;
  podIp?: string;
  lastHeartbeat?: Date;
  openclawStatus?: string;
  errors?: string[];
}

@Injectable()
export class AgentManagerService {
  private readonly logger = new Logger(AgentManagerService.name);
  private readonly namespace = 'genesis';
  private readonly templatePath: string;

  constructor(
    @InjectRepository(Agent)
    private readonly agentsRepository: Repository<Agent>,
  ) {
    // 查找模板文件路径
    const possiblePaths = [
      path.join(process.cwd(), 'k8s', 'genesis-agent-template.yaml'),
      path.join(
        __dirname,
        '..',
        '..',
        '..',
        'k8s',
        'genesis-agent-template.yaml',
      ),
      '/home/ubuntu/CSI-agent-project/k8s/genesis-agent-template.yaml',
    ];

    this.templatePath =
      possiblePaths.find((p) => fs.existsSync(p)) || possiblePaths[0];
    this.logger.log(`Using agent template: ${this.templatePath}`);
  }

  /**
   * 为用户自动创建并部署 Agent
   */
  async createAgentForUser(user: User, ownerToken: string): Promise<Agent> {
    const userId = user.id;
    const userPhone = user.phone || userId.slice(0, 8);

    this.logger.log(`Creating agent for user ${userId}, phone: ${userPhone}`);

    // 1. 检查用户是否已有 Agent
    const existingAgents = await this.agentsRepository.find({
      where: { owner: { id: userId }, isActive: true },
    });

    if (existingAgents.length > 0) {
      this.logger.log(
        `User ${userId} already has ${existingAgents.length} agent(s)`,
      );
      return existingAgents[0];
    }

    // 2. 生成 Agent 配置（使用手机号作为 K8s 资源标识）
    const config = this.generateAgentConfig(userId, ownerToken, userPhone);

    // 3. 在数据库中创建 Agent 记录
    const agent = this.agentsRepository.create({
      id: config.agentId,
      name: `agent-${userPhone}`,
      description: `Auto-created agent for user ${userPhone}`,
      owner: user,
      status: AgentStatus.OFFLINE, // 初始状态为离线，部署完成后更新
      externalId: config.externalId,
      agentMode: 'kubernetes',
      webhookUrl: `http://agent-${userPhone}.${this.namespace}.svc.cluster.local:3000/webhook`,
    });

    await this.agentsRepository.save(agent);

    // 4. 在 K8s 中部署 Agent
    try {
      await this.deployAgentToK8s(config);
      this.logger.log(
        `Agent ${config.agentId} deployed successfully for user ${userId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to deploy agent for user ${userId}:`, error);
      // 部署失败，标记为不活跃
      agent.isActive = false;
      await this.agentsRepository.save(agent);
      throw error;
    }

    return agent;
  }

  /**
   * 生成 Agent 配置
   */
  private generateAgentConfig(
    userId: string,
    ownerToken: string,
    userPhone?: string,
  ): AgentDeploymentConfig {
    const agentId = this.generateUUID();
    const apiKey = this.generateApiKey();
    const externalId = `agent-${userPhone || userId.slice(0, 8)}-${Date.now().toString(36)}`;

    return {
      userId,
      agentId,
      externalId,
      apiKey,
      ownerToken,
      userPhone,
      openclawInstance: 'grey', // 默认使用 grey 实例
      resources: {
        memory: '256Mi',
        cpu: '250m',
      },
    };
  }

  /**
   * 在 Kubernetes 中部署 Agent
   */
  private async deployAgentToK8s(config: AgentDeploymentConfig): Promise<void> {
    const { userId, agentId, externalId, apiKey, ownerToken, userPhone } =
      config;

    // 使用手机号作为 K8s 资源标识（确保手机号和 Agent 一一绑定）
    const k8sResourceId = userPhone || userId;

    // 检查模板文件是否存在
    if (!fs.existsSync(this.templatePath)) {
      throw new Error(`Template file not found: ${this.templatePath}`);
    }

    // 读取模板并替换变量
    let template = fs.readFileSync(this.templatePath, 'utf-8');

    // 替换所有变量（使用手机号作为 K8s 资源名称）
    template = template
      .replace(/\$\{USER_ID\}/g, k8sResourceId)
      .replace(/\$\{AGENT_ID\}/g, agentId)
      .replace(/\$\{EXTERNAL_ID\}/g, externalId)
      .replace(/\$\{AGENT_API_KEY\}/g, apiKey)
      .replace(/\$\{OWNER_TOKEN\}/g, ownerToken);

    // 写入临时文件
    const tempFile = `/tmp/genesis-agent-${k8sResourceId}.yaml`;
    fs.writeFileSync(tempFile, template);

    try {
      // 应用配置
      const { stdout, stderr } = await execAsync(
        `kubectl apply -f ${tempFile}`,
      );

      if (stderr && !stderr.includes('Warning')) {
        this.logger.warn(`kubectl apply warning: ${stderr}`);
      }

      this.logger.log(`kubectl apply output: ${stdout}`);

      // 等待部署完成
      await this.waitForDeployment(k8sResourceId);
    } finally {
      // 清理临时文件
      try {
        fs.unlinkSync(tempFile);
      } catch {
        // 忽略清理错误
      }
    }
  }

  /**
   * 等待 Deployment 就绪
   */
  private async waitForDeployment(
    k8sResourceId: string,
    timeout = 120000,
  ): Promise<void> {
    const deploymentName = `agent-${k8sResourceId}`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const { stdout } = await execAsync(
          `kubectl get deployment ${deploymentName} -n ${this.namespace} -o jsonpath='{.status.readyReplicas}'`,
        );

        const readyReplicas = parseInt(stdout.trim(), 10);

        if (readyReplicas >= 1) {
          this.logger.log(`Deployment ${deploymentName} is ready`);
          return;
        }
      } catch {
        // 忽略错误，继续等待
      }

      await this.sleep(3000);
    }

    throw new Error(`Timeout waiting for deployment ${deploymentName}`);
  }

  /**
   * 销毁用户的 Agent
   */
  async destroyAgentForUser(userId: string, userPhone?: string): Promise<void> {
    this.logger.log(`Destroying agent for user ${userId}`);

    // 使用手机号作为 K8s 资源标识
    const k8sResourceId = userPhone || userId;
    const deploymentName = `agent-${k8sResourceId}`;
    const serviceName = `agent-${k8sResourceId}`;

    try {
      // 删除 Deployment
      await execAsync(
        `kubectl delete deployment ${deploymentName} -n ${this.namespace} --ignore-not-found`,
      );

      // 删除 Service
      await execAsync(
        `kubectl delete service ${serviceName} -n ${this.namespace} --ignore-not-found`,
      );

      // 更新数据库
      await this.agentsRepository.update(
        { owner: { id: userId } },
        { isActive: false, status: AgentStatus.OFFLINE },
      );

      this.logger.log(`Agent for user ${userId} destroyed successfully`);
    } catch (error) {
      this.logger.error(`Failed to destroy agent for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * 获取 Agent 状态
   */
  async getAgentStatus(
    userId: string,
    userPhone?: string,
  ): Promise<AgentStatusInfo | null> {
    // 使用手机号作为 K8s 资源标识
    const k8sResourceId = userPhone || userId;

    try {
      // 获取 Pod 信息
      const { stdout: podJson } = await execAsync(
        `kubectl get pods -n ${this.namespace} -l app=agent-${k8sResourceId},userId=${k8sResourceId} -o json`,
      );

      const pods = JSON.parse(podJson) as K8sPodList;

      if (pods.items.length === 0) {
        return null;
      }

      const pod = pods.items[0];
      const agent = await this.agentsRepository.findOne({
        where: { owner: { id: userId }, isActive: true },
      });

      return {
        agentId: agent?.id || 'unknown',
        status:
          pod.status.phase === 'Running'
            ? AgentStatus.ONLINE
            : AgentStatus.OFFLINE,
        podName: pod.metadata.name,
        podIp: pod.status.podIP,
        lastHeartbeat: agent?.lastHeartbeatAt || undefined,
        openclawStatus: agent?.openclawStatus,
        errors: pod.status.containerStatuses?.[0]?.state?.waiting?.message
          ? [pod.status.containerStatuses[0].state.waiting.message]
          : undefined,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get agent status for user ${userId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * 重启用户的 Agent
   */
  async restartAgent(userId: string, userPhone?: string): Promise<void> {
    // 使用手机号作为 K8s 资源标识
    const k8sResourceId = userPhone || userId;
    const deploymentName = `agent-${k8sResourceId}`;

    try {
      await execAsync(
        `kubectl rollout restart deployment ${deploymentName} -n ${this.namespace}`,
      );
      await this.waitForDeployment(k8sResourceId);
      this.logger.log(`Agent for user ${userId} restarted successfully`);
    } catch (error) {
      this.logger.error(`Failed to restart agent for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * 列出所有用户的 Agent Pod
   */
  async listAllAgentPods(): Promise<
    Array<{
      userId: string | undefined;
      agentId: string | undefined;
      podName: string;
      status: string;
      ready: boolean | undefined;
      restarts: number | undefined;
      age: string | undefined;
    }>
  > {
    try {
      // 获取所有 agent-* 的 pods（使用手机号作为标识）
      const { stdout } = await execAsync(
        `kubectl get pods -n ${this.namespace} -l agentId -o json`,
      );

      const pods = JSON.parse(stdout) as K8sPodList;
      return pods.items.map((pod) => ({
        userId: pod.metadata.labels?.userId,
        agentId: pod.metadata.labels?.agentId,
        podName: pod.metadata.name,
        status: pod.status.phase,
        ready: pod.status.containerStatuses?.[0]?.ready,
        restarts: pod.status.containerStatuses?.[0]?.restartCount,
        age: pod.metadata.creationTimestamp,
      }));
    } catch (error) {
      this.logger.error('Failed to list agent pods:', error);
      return [];
    }
  }

  /**
   * 生成 UUID
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * 生成 API Key
   */
  private generateApiKey(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
