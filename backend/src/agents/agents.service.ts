/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import {
  Agent,
  AgentApprovalStatus,
  AgentRuntimeStatus,
  AgentStatus,
  AgentType,
  OpenclawStatus,
} from './entities/agent.entity';
import { AgentCredential } from './entities/agent-credential.entity';
import { AgentAuditLog } from './entities/agent-audit-log.entity';
import { User } from '../users/entities/user.entity';
import { WebhookDelivery } from '../webhooks/entities/webhook-delivery.entity';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AgentCardJson, AgentCardService } from './agent-card.service';
import { AgentsHealthService } from './agents-health.service';

type CreateAgentDto = {
  name: string;
  description?: string;
  webhookUrl?: string;
  skills?: string[];
  domains?: string[];
  tags?: string[];
  podName?: string;
  externalId?: string;
  agentMode?: 'kubernetes' | 'external';
  agentType?: AgentType;
  cardUrl?: string;
  cardJson?: AgentCardJson;
  endpointUrl?: string;
  healthUrl?: string;
  authType?: 'bearer' | 'api_key' | 'signature' | 'mtls' | 'none';
  pricingModel?: string;
  basePrice?: number;
  currency?: string;
  contactEmail?: string;
};

const SYSTEM_DEFAULT_AGENT_PREFIX = 'system-default-';
const DEFAULT_PLATFORM_AGENT_SKILLS = [
  'task_analysis',
  'code_generation',
  'data_processing',
  'ai_integration',
];

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    @InjectRepository(Agent)
    private agentsRepository: Repository<Agent>,
    @InjectRepository(AgentCredential)
    private agentCredentialsRepository: Repository<AgentCredential>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(WebhookDelivery)
    private webhookDeliveriesRepository: Repository<WebhookDelivery>,
    @InjectRepository(AgentAuditLog)
    private agentAuditLogsRepository: Repository<AgentAuditLog>,
    private httpService: HttpService,
    private agentCardService: AgentCardService,
    private agentsHealthService: AgentsHealthService,
  ) {}

  private hashKey(key: string) {
    return createHash('sha256').update(key).digest('hex');
  }

  async ensureDefaultSystemAgent(owner: User) {
    if (!owner?.id) {
      throw new NotFoundException('Owner not found');
    }

    const externalId = `${SYSTEM_DEFAULT_AGENT_PREFIX}${owner.id}`;
    const existing = await this.agentsRepository.findOne({
      where: { externalId },
      relations: ['owner', 'cards', 'capabilities', 'tags'],
    });

    if (existing) {
      const updates: Partial<Agent> = {};
      if (existing.agentType !== AgentType.PLATFORM_MANAGED) {
        updates.agentType = AgentType.PLATFORM_MANAGED;
      }
      if (existing.agentMode !== 'kubernetes') {
        updates.agentMode = 'kubernetes';
      }
      if (existing.approvalStatus !== AgentApprovalStatus.APPROVED) {
        updates.approvalStatus = AgentApprovalStatus.APPROVED;
        updates.approvedAt = new Date();
      }
      const metadata = this.defaultSystemAgentMetadata(owner.id, existing.metadata);
      if (JSON.stringify(existing.metadata || {}) !== JSON.stringify(metadata)) {
        updates.metadata = metadata;
      }
      if (Object.keys(updates).length > 0) {
        Object.assign(existing, updates);
        await this.agentsRepository.save(existing);
      }
      return this.findOneWithDetails(existing.id);
    }

    const endpointUrl = this.defaultRuntimeEndpointUrl();
    const healthUrl = this.defaultRuntimeHealthUrl(endpointUrl);
    const displayName = owner.displayName || owner.phone || owner.id.slice(0, 8);

    const agent = this.agentsRepository.create({
      name: `${displayName} Default Agent`,
      description:
        'System-created default agent backed by the platform Agent Runtime.',
      webhookUrl: endpointUrl,
      owner,
      status: AgentStatus.ONLINE,
      approvalStatus: AgentApprovalStatus.APPROVED,
      runtimeStatus: AgentRuntimeStatus.ONLINE,
      agentType: AgentType.PLATFORM_MANAGED,
      agentMode: 'kubernetes',
      isActive: false,
      visibility: 'public',
      externalId,
      endpointUrl,
      healthUrl,
      authType: 'bearer',
      pricingModel: 'quote',
      currency: 'CNY',
      approvedAt: new Date(),
      lastHeartbeatAt: new Date(),
      skills: DEFAULT_PLATFORM_AGENT_SKILLS,
      metadata: this.defaultSystemAgentMetadata(owner.id),
    });

    const saved = await this.agentsRepository.save(agent);
    const card = this.agentCardService.buildPlatformCard({
      name: saved.name,
      description: saved.description,
      agentType: saved.agentType,
      endpointUrl: saved.endpointUrl || undefined,
      webhookUrl: saved.webhookUrl || undefined,
      healthUrl: saved.healthUrl || undefined,
      authType: saved.authType,
      domains: ['general'],
      skills: DEFAULT_PLATFORM_AGENT_SKILLS,
      pricingModel: saved.pricingModel,
      currency: saved.currency,
      tags: this.defaultSystemAgentTags(owner.id),
    });

    await this.agentCardService.saveActiveCard({
      agent: saved,
      card,
      source: 'platform',
    });
    await this.agentCardService.replaceExtractedMetadata(saved, card);
    await this.writeAudit(saved, owner, 'system_default_assigned', null, {
      approvalStatus: saved.approvalStatus,
      isActive: saved.isActive,
      metadata: saved.metadata,
    });

    return this.findOneWithDetails(saved.id);
  }

  async create(data: CreateAgentDto, ownerId: string) {
    const owner = await this.usersRepository.findOne({
      where: { id: ownerId },
    });
    if (!owner) {
      throw new NotFoundException('Owner not found');
    }

    const agent = this.agentsRepository.create({
      name: data.name,
      description: data.description,
      webhookUrl: data.webhookUrl,
      owner: owner,
      status: AgentStatus.ONLINE, // 默认上线
      approvalStatus: AgentApprovalStatus.PENDING_REVIEW,
      runtimeStatus: AgentRuntimeStatus.ONLINE,
      agentType:
        data.agentType ||
        (data.agentMode === 'external'
          ? AgentType.SELF_HOSTED
          : AgentType.PLATFORM_MANAGED),
      cardUrl: data.cardUrl || null,
      endpointUrl: data.endpointUrl || data.webhookUrl || null,
      healthUrl: data.healthUrl || null,
      authType: data.authType || 'bearer',
      pricingModel: data.pricingModel || 'quote',
      basePrice: data.basePrice ?? null,
      currency: data.currency || 'CNY',
      contactEmail: data.contactEmail || null,
      podName: data.podName,
      externalId: data.externalId,
      agentMode: data.agentMode || 'kubernetes',
      lastHeartbeatAt: new Date(), // 注册时设置心跳时间，避免被立即标记为离线
      skills:
        Array.isArray(data.skills) && data.skills.length > 0
          ? Array.from(
              new Set(
                data.skills
                  .filter((s) => typeof s === 'string')
                  .map((s) => s.trim())
                  .filter(Boolean),
              ),
            )
          : undefined,
    });

    const saved = await this.agentsRepository.save(agent);
    const card =
      data.cardJson ||
      this.agentCardService.buildPlatformCard({
        name: data.name,
        description: data.description,
        agentType: saved.agentType,
        endpointUrl: saved.endpointUrl || undefined,
        webhookUrl: saved.webhookUrl || undefined,
        healthUrl: saved.healthUrl || undefined,
        authType: saved.authType,
        domains: data.domains,
        skills: data.skills,
        pricingModel: saved.pricingModel,
        currency: saved.currency,
        minimumPrice: saved.basePrice || undefined,
        tags: data.tags,
      });

    await this.agentCardService.saveActiveCard({
      agent: saved,
      card,
      source: data.cardJson ? 'manual' : 'platform',
    });
    await this.agentCardService.replaceExtractedMetadata(saved, card);
    await this.writeAudit(saved, owner, 'register', null, {
      approvalStatus: saved.approvalStatus,
      runtimeStatus: saved.runtimeStatus,
    });

    return this.findOneWithDetails(saved.id);
  }

  async registerExternal(data: CreateAgentDto, ownerId: string) {
    const owner = await this.usersRepository.findOne({ where: { id: ownerId } });
    if (!owner) throw new NotFoundException('Owner not found');

    const card = data.cardJson
      ? this.agentCardService.validate(data.cardJson)
      : data.cardUrl
        ? await this.agentCardService.fetchAndValidate(data.cardUrl)
        : null;
    if (!card) {
      throw new BadRequestException('cardUrl or cardJson is required');
    }

    const agent = this.agentsRepository.create({
      name: card.name || data.name,
      description: card.description || data.description,
      webhookUrl: card.endpoints?.webhook || card.endpoints?.callback || data.webhookUrl,
      owner,
      skills: this.extractSkillNames(card),
      status: AgentStatus.OFFLINE,
      approvalStatus: AgentApprovalStatus.PENDING_REVIEW,
      runtimeStatus: AgentRuntimeStatus.UNKNOWN,
      agentType: AgentType.SELF_HOSTED,
      agentMode: 'external',
      externalId: card.agent_id || data.externalId,
      cardUrl: data.cardUrl || null,
      endpointUrl: card.endpoints?.task || data.endpointUrl || null,
      healthUrl: card.endpoints?.health || data.healthUrl || null,
      authType: (card.auth?.type as Agent['authType']) || data.authType || 'bearer',
      pricingModel: card.pricing?.model || data.pricingModel || 'quote',
      basePrice: card.pricing?.minimum_price ?? data.basePrice ?? null,
      currency: card.pricing?.currency || data.currency || 'CNY',
      contactEmail: card.provider?.contact_email || data.contactEmail || null,
      version: card.version || '1.0.0',
      metadata: card.metadata || null,
    });

    const saved = await this.agentsRepository.save(agent);
    await this.agentCardService.saveActiveCard({
      agent: saved,
      card,
      source: data.cardUrl ? 'remote_fetch' : 'manual',
      fetchedAt: data.cardUrl ? new Date() : null,
    });
    await this.agentCardService.replaceExtractedMetadata(saved, card);
    await this.writeAudit(saved, owner, 'register_external', null, {
      approvalStatus: saved.approvalStatus,
      cardUrl: saved.cardUrl,
    });

    return this.findOneWithDetails(saved.id);
  }

  /**
   * 根据 externalId 查找或创建 Agent
   * 用于 Pod 重启后的重新注册，保持 AGENT_ID 不变
   */
  async upsertByExternalId(data: CreateAgentDto, ownerId: string) {
    // 1. 查找现有 Agent
    const agent = await this.agentsRepository.findOne({
      where: { externalId: data.externalId },
      relations: ['owner'],
    });

    // 2. 如果存在且属于同一用户，更新信息
    if (agent && agent.owner?.id === ownerId) {
      this.logger.log(
        `Updating existing agent ${agent.id} with externalId ${data.externalId}`,
      );

      // 更新关键字段
      if (data.webhookUrl !== undefined) agent.webhookUrl = data.webhookUrl;
      if (data.podName !== undefined) agent.podName = data.podName;
      agent.status = AgentStatus.ONLINE;
      agent.lastHeartbeatAt = new Date();
      agent.consecutiveFailures = 0;

      // 可选更新字段
      if (data.name) agent.name = data.name;
      if (data.description) agent.description = data.description;
      if (data.skills) {
        agent.skills = Array.from(
          new Set(
            data.skills
              .filter((s) => typeof s === 'string')
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        );
      }
      if (data.agentMode) agent.agentMode = data.agentMode;

      return this.agentsRepository.save(agent);
    }

    // 3. 不存在，创建新 Agent
    this.logger.log(`Creating new agent with externalId ${data.externalId}`);
    return this.create(data, ownerId);
  }

  /**
   * 用于 Agent 自己更新信息（通过 API Key 认证）
   */
  async upsertByExternalIdForAgent(data: CreateAgentDto, agentId: string) {
    // 1. 查找现有 Agent
    const agent = await this.agentsRepository.findOne({
      where: { externalId: data.externalId },
      relations: ['owner'],
    });

    // 2. 如果存在且是同一个 Agent，更新信息
    if (agent && agent.id === agentId) {
      this.logger.log(
        `Agent ${agentId} updating itself with externalId ${data.externalId}`,
      );

      // 更新关键字段
      if (data.webhookUrl !== undefined) agent.webhookUrl = data.webhookUrl;
      if (data.podName !== undefined) agent.podName = data.podName;
      agent.status = AgentStatus.ONLINE;
      agent.lastHeartbeatAt = new Date();
      agent.consecutiveFailures = 0;

      // 可选更新字段
      if (data.name) agent.name = data.name;
      if (data.description) agent.description = data.description;
      if (data.skills) {
        agent.skills = Array.from(
          new Set(
            data.skills
              .filter((s) => typeof s === 'string')
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        );
      }
      if (data.agentMode) agent.agentMode = data.agentMode;

      return this.agentsRepository.save(agent);
    }

    // 3. 不存在或不属于该 Agent，返回错误
    throw new ForbiddenException('Agent not found or externalId mismatch');
  }

  async findByUser(userId: string) {
    const agents = await this.agentsRepository.find({
      where: { owner: { id: userId } },
      relations: ['owner', 'capabilities', 'tags'],
      order: { createdAt: 'DESC' },
    });

    const now = Date.now();

    return agents.map((agent) => {
      const runtimeStatus = this.agentsHealthService.calculateRuntimeStatus(
        agent.lastHeartbeatAt,
        now,
      );
      return {
        ...agent,
        runtimeStatus,
        status:
          runtimeStatus === AgentRuntimeStatus.OFFLINE
            ? AgentStatus.OFFLINE
            : AgentStatus.ONLINE,
      };
    });
  }

  async findOne(id: string) {
    return this.agentsRepository.findOne({ where: { id } });
  }

  async findOneWithDetails(id: string) {
    return this.agentsRepository.findOne({
      where: { id },
      relations: ['owner', 'cards', 'capabilities', 'tags'],
    });
  }

  async findOneWithOwner(id: string) {
    return this.agentsRepository.findOne({
      where: { id },
      relations: ['owner'],
    });
  }

  async updateSkills(agentId: string, skills: string[]) {
    const agent = await this.findOne(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    agent.skills = Array.from(
      new Set(
        skills
          .filter((s) => typeof s === 'string')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    );
    return this.agentsRepository.save(agent);
  }

  async listWebhookDeliveries(agentId: string) {
    return this.webhookDeliveriesRepository.find({
      where: { agent: { id: agentId } },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async listApiKeys(agentId: string) {
    return this.agentCredentialsRepository.find({
      where: { agent: { id: agentId } },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async updateWebhookUrl(agentId: string, webhookUrl: string) {
    const agent = await this.findOne(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    agent.webhookUrl = webhookUrl;
    return this.agentsRepository.save(agent);
  }

  async createApiKey(params: { agentId: string; name?: string }) {
    const agent = await this.findOne(params.agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    const plain = randomBytes(32).toString('base64url');
    const secretHash = this.hashKey(plain);
    const row = await this.agentCredentialsRepository.save(
      this.agentCredentialsRepository.create({
        agent,
        name:
          typeof params.name === 'string' && params.name.trim().length > 0
            ? params.name.trim()
            : null,
        secretHash,
        keyId: `ak_${randomBytes(8).toString('hex')}`,
        scopes: ['*'],
        status: 'active',
        revokedAt: null,
        lastUsedAt: null,
      }),
    );

    return {
      id: row.id,
      keyId: row.keyId,
      name: row.name,
      apiKey: plain,
      createdAt: row.createdAt,
    };
  }

  async revokeApiKey(params: { agentId: string; keyId: string }) {
    const row = await this.agentCredentialsRepository.findOne({
      where: { id: params.keyId, agent: { id: params.agentId } },
      relations: ['agent'],
    });
    if (!row) throw new NotFoundException('API key not found');
    if (!row.revokedAt) {
      row.revokedAt = new Date();
      row.status = 'revoked';
      await this.agentCredentialsRepository.save(row);
    }
    return { id: row.id, revokedAt: row.revokedAt };
  }

  async validateAgentApiKey(plain: string) {
    const secretHash = this.hashKey(plain);
    const row = await this.agentCredentialsRepository.findOne({
      where: { secretHash },
      relations: ['agent'],
    });
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.status !== 'active') return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
    row.lastUsedAt = new Date();
    await this.agentCredentialsRepository.save(row);
    return row.agent || null;
  }

  /**
   * Agent 心跳 - 更新在线状态
   * 成功时重置连续失败计数，保持 ONLINE
   */
  async heartbeat(agentId: string) {
    return this.agentsHealthService.recordHeartbeat(agentId);
  }

  async heartbeatWithPayload(
    agentId: string,
    body?: {
      status?: string;
      latencyMs?: number;
      latency_ms?: number;
      load?: number;
      load_metric?: number;
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.agentsHealthService.recordHeartbeat(agentId, {
      status: body?.status,
      latencyMs: body?.latencyMs ?? body?.latency_ms,
      load: body?.load ?? body?.load_metric,
      metadata: body?.metadata,
    });
  }

  /**
   * Agent 心跳失败 - 增加失败计数
   * 连续 2 次失败则标记为 OFFLINE
   */
  async heartbeatFailed(agentId: string) {
    const agent = await this.findOne(agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    agent.consecutiveFailures = (agent.consecutiveFailures || 0) + 1;

    // 连续 2 次失败则标记为 OFFLINE
    if (agent.consecutiveFailures >= 2) {
      agent.status = AgentStatus.OFFLINE;
      agent.runtimeStatus = AgentRuntimeStatus.OFFLINE;
    }

    await this.agentsRepository.save(agent);

    return {
      success: true,
      agentId: agent.id,
      status: agent.status,
      consecutiveFailures: agent.consecutiveFailures,
    };
  }

  /**
   * 获取 Agent 状态
   * 根据心跳时间动态判断，不依赖 status 字段
   */
  async getStatus(agentId: string) {
    const agent = await this.findOne(agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    const runtimeStatus = this.agentsHealthService.calculateRuntimeStatus(
      agent.lastHeartbeatAt,
    );

    return {
      agentId: agent.id,
      name: agent.name,
      status:
        runtimeStatus === AgentRuntimeStatus.OFFLINE
          ? AgentStatus.OFFLINE
          : AgentStatus.ONLINE,
      runtimeStatus,
      lastHeartbeatAt: agent.lastHeartbeatAt,
      heartbeatIntervalMs: agent.heartbeatIntervalMs,
    };
  }

  /**
   * 批量检查并更新超时 Agent 状态
   */
  async checkOfflineAgents(): Promise<number> {
    return this.agentsHealthService.refreshTimeoutStatuses();
  }

  async approve(agentId: string, reviewerId?: string, comment?: string) {
    const agent = await this.findOne(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    const before = {
      approvalStatus: agent.approvalStatus,
      runtimeStatus: agent.runtimeStatus,
    };
    agent.approvalStatus = AgentApprovalStatus.APPROVED;
    agent.approvedAt = new Date();
    if (agent.lastHeartbeatAt) {
      agent.runtimeStatus = AgentRuntimeStatus.ONLINE;
      agent.status = AgentStatus.ONLINE;
    }
    const saved = await this.agentsRepository.save(agent);
    await this.writeAudit(saved, null, 'approve', before, {
      approvalStatus: saved.approvalStatus,
      reviewerId,
      comment,
    });
    return saved;
  }

  async reject(agentId: string, reviewerId?: string, comment?: string) {
    const agent = await this.findOne(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    const before = { approvalStatus: agent.approvalStatus };
    agent.approvalStatus = AgentApprovalStatus.REJECTED;
    agent.runtimeStatus = AgentRuntimeStatus.UNKNOWN;
    agent.status = AgentStatus.OFFLINE;
    const saved = await this.agentsRepository.save(agent);
    await this.writeAudit(saved, null, 'reject', before, {
      approvalStatus: saved.approvalStatus,
      reviewerId,
      comment,
    });
    return saved;
  }

  async enable(agentId: string, actorId?: string) {
    const agent = await this.findOneWithOwner(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    if (actorId && agent.owner?.id !== actorId) {
      throw new ForbiddenException('Only the agent owner can enable it');
    }
    const before = {
      approvalStatus: agent.approvalStatus,
      isActive: agent.isActive,
    };
    if (agent.approvalStatus === AgentApprovalStatus.REJECTED) {
      throw new ForbiddenException('Rejected agents cannot be enabled');
    }
    if (agent.approvalStatus === AgentApprovalStatus.DISABLED) {
      throw new ForbiddenException('Disabled agents must be re-enabled by an admin');
    }
    if (
      !this.isSystemDefaultAgent(agent) &&
      agent.approvalStatus !== AgentApprovalStatus.APPROVED
    ) {
      throw new ForbiddenException('Agent must be approved before it can be enabled');
    }
    agent.isActive = true;
    if (this.isSystemDefaultAgent(agent)) {
      agent.approvalStatus = AgentApprovalStatus.APPROVED;
      agent.runtimeStatus = AgentRuntimeStatus.ONLINE;
      agent.status = AgentStatus.ONLINE;
      agent.lastHeartbeatAt = new Date();
      agent.approvedAt = agent.approvedAt || new Date();
    }
    const saved = await this.agentsRepository.save(agent);
    await this.writeAudit(saved, null, 'enable', before, { actorId });
    return saved;
  }

  async disable(agentId: string, actorId?: string, enforceOwner = true) {
    const agent = await this.findOneWithOwner(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    if (enforceOwner && actorId && agent.owner?.id !== actorId) {
      throw new ForbiddenException('Only the agent owner can disable it');
    }
    const before = {
      approvalStatus: agent.approvalStatus,
      runtimeStatus: agent.runtimeStatus,
      isActive: agent.isActive,
    };
    agent.isActive = false;
    if (!enforceOwner) {
      agent.approvalStatus = AgentApprovalStatus.DISABLED;
      agent.runtimeStatus = AgentRuntimeStatus.OFFLINE;
      agent.status = AgentStatus.OFFLINE;
    }
    const saved = await this.agentsRepository.save(agent);
    await this.writeAudit(saved, null, 'disable', before, { actorId });
    return saved;
  }

  async listPendingReview() {
    return this.agentsRepository.find({
      where: { approvalStatus: AgentApprovalStatus.PENDING_REVIEW },
      relations: ['owner', 'cards', 'capabilities', 'tags'],
      order: { createdAt: 'DESC' },
    });
  }

  async listAllForAdmin() {
    return this.agentsRepository.find({
      relations: ['owner', 'cards', 'capabilities', 'tags'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 更新 Agent 收款信息
   */
  async updatePayment(
    agentId: string,
    data: {
      paymentQrUrl?: string;
      paymentQrType?: string;
      paymentAccount?: string;
    },
  ) {
    const agent = await this.findOne(agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    if (data.paymentQrUrl !== undefined) {
      agent.paymentQrUrl = data.paymentQrUrl ?? '';
    }
    if (data.paymentQrType !== undefined) {
      agent.paymentQrType = data.paymentQrType ?? '';
    }
    if (data.paymentAccount !== undefined) {
      agent.paymentAccount = data.paymentAccount ?? '';
    }

    await this.agentsRepository.save(agent);

    return {
      id: agent.id,
      paymentQrUrl: agent.paymentQrUrl,
      paymentQrType: agent.paymentQrType,
      paymentAccount: agent.paymentAccount,
    };
  }

  /**
   * 执行 Agent 健康检查
   * 检查 Agent Pod 状态、心跳、Openclaw 可达性
   */
  async healthCheck(agentId: string) {
    const agent = await this.findOne(agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    const errors: string[] = [];
    const checks = {
      podRunning: false,
      heartbeatValid: false,
      openclawReachable: false,
      configurationValid: false,
    };

    // 1. 检查 Agent 心跳是否在 60 秒内
    const timeoutMs = 60000;
    const lastHeartbeat = agent.lastHeartbeatAt
      ? new Date(agent.lastHeartbeatAt).getTime()
      : 0;
    checks.heartbeatValid =
      lastHeartbeat > 0 && Date.now() - lastHeartbeat < timeoutMs;

    if (!checks.heartbeatValid) {
      errors.push('Agent heartbeat timeout (no heartbeat in 60s)');
      // 如果心跳超时，标记为 OFFLINE
      agent.status = AgentStatus.OFFLINE;
    } else {
      checks.podRunning = true;
      agent.status = AgentStatus.ONLINE;
    }

    // 2. 检查 Openclaw 是否可访问
    if (agent.openclawUrl) {
      try {
        const response = await firstValueFrom(
          this.httpService.get(`${agent.openclawUrl}/health`, {
            timeout: 5000,
          }),
        );
        checks.openclawReachable = response.status === 200;
        agent.openclawStatus = checks.openclawReachable
          ? OpenclawStatus.CONNECTED
          : OpenclawStatus.DISCONNECTED;
      } catch (error: unknown) {
        checks.openclawReachable = false;
        agent.openclawStatus = OpenclawStatus.DISCONNECTED;
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Openclaw unreachable: ${errorMessage}`);
      }
    } else {
      agent.openclawStatus = OpenclawStatus.UNKNOWN;
      errors.push('Openclaw URL not configured');
    }

    // 3. 检查配置是否有效
    checks.configurationValid = !!agent.webhookUrl && !!agent.openclawUrl;
    if (!checks.configurationValid) {
      if (!agent.webhookUrl) errors.push('Webhook URL not configured');
      if (!agent.openclawUrl) errors.push('Openclaw URL not configured');
    }

    // 更新健康检查结果
    agent.lastHealthCheckAt = new Date();
    agent.healthCheckResult = {
      agentOnline: checks.heartbeatValid,
      openclawReachable: checks.openclawReachable,
      skillsLoaded: Array.isArray(agent.skills) && agent.skills.length > 0,
      errors: errors.length > 0 ? errors : undefined,
    };

    await this.agentsRepository.save(agent);

    return {
      agentId: agent.id,
      status: agent.status,
      openclawStatus: agent.openclawStatus,
      lastHeartbeatAt: agent.lastHeartbeatAt,
      lastHealthCheckAt: agent.lastHealthCheckAt,
      checks,
      errors,
    };
  }

  /**
   * 获取 Agent 健康状态
   */
  async getHealthStatus(agentId: string) {
    const agent = await this.findOne(agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    // 实时计算 Agent 在线状态
    const timeoutMs = 60000;
    const lastHeartbeat = agent.lastHeartbeatAt
      ? new Date(agent.lastHeartbeatAt).getTime()
      : 0;
    const isOnline =
      lastHeartbeat > 0 && Date.now() - lastHeartbeat < timeoutMs;

    return {
      agentId: agent.id,
      status: isOnline ? AgentStatus.ONLINE : AgentStatus.OFFLINE,
      openclawStatus: agent.openclawStatus || OpenclawStatus.UNKNOWN,
      lastHeartbeatAt: agent.lastHeartbeatAt,
      lastHealthCheckAt: agent.lastHealthCheckAt,
      healthCheckResult: agent.healthCheckResult,
    };
  }

  /**
   * 更新 Openclaw URL
   */
  async updateOpenclawUrl(agentId: string, openclawUrl: string) {
    const agent = await this.findOne(agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    agent.openclawUrl = openclawUrl;
    agent.openclawStatus = OpenclawStatus.UNKNOWN; // 重置状态，等待健康检查
    await this.agentsRepository.save(agent);

    return {
      id: agent.id,
      openclawUrl: agent.openclawUrl,
      openclawStatus: agent.openclawStatus,
    };
  }

  /**
   * 更新 Agent ID（用于同步 K8s Pod 标签中的 ID）
   */
  async updateAgentId(oldId: string, newId: string) {
    const agent = await this.findOne(oldId);
    if (!agent) throw new NotFoundException('Agent not found');

    // 创建新 ID 的 Agent
    const newAgent = this.agentsRepository.create({
      ...agent,
      id: newId,
    });

    // 保存新 Agent
    await this.agentsRepository.save(newAgent);

    // 删除旧 Agent
    await this.agentsRepository.delete(oldId);

    return {
      oldId,
      newId,
      message: 'Agent ID updated successfully',
    };
  }

  private extractSkillNames(card: AgentCardJson) {
    return (card.capabilities?.skills || [])
      .map((skill) => (typeof skill === 'string' ? skill : skill.name || ''))
      .filter(Boolean);
  }

  private defaultRuntimeEndpointUrl() {
    return (
      process.env.DEFAULT_AGENT_RUNTIME_ENDPOINT_URL ||
      process.env.PLATFORM_AGENT_RUNTIME_ENDPOINT_URL ||
      'http://genesis-agent.genesis.svc.cluster.local:3000/webhook'
    );
  }

  private defaultRuntimeHealthUrl(endpointUrl: string) {
    if (process.env.DEFAULT_AGENT_RUNTIME_HEALTH_URL) {
      return process.env.DEFAULT_AGENT_RUNTIME_HEALTH_URL;
    }
    if (process.env.PLATFORM_AGENT_RUNTIME_HEALTH_URL) {
      return process.env.PLATFORM_AGENT_RUNTIME_HEALTH_URL;
    }
    return endpointUrl.endsWith('/webhook')
      ? endpointUrl.replace(/\/webhook$/, '/health')
      : endpointUrl;
  }

  private defaultSystemAgentTags(ownerId: string) {
    return ['system-created', `owner:${ownerId}`, 'platform-runtime'];
  }

  private defaultSystemAgentMetadata(
    ownerId: string,
    existing?: Record<string, unknown> | null,
  ) {
    return {
      ...(existing || {}),
      createdBy: 'system',
      systemCreated: true,
      defaultAgent: true,
      ownerUserId: ownerId,
      tags: this.defaultSystemAgentTags(ownerId),
    };
  }

  private isSystemDefaultAgent(agent: Agent) {
    return (
      agent.agentType === AgentType.PLATFORM_MANAGED &&
      agent.metadata?.createdBy === 'system' &&
      agent.metadata?.defaultAgent === true
    );
  }

  private async writeAudit(
    agent: Agent | null,
    actor: User | null,
    action: string,
    beforeValue: Record<string, unknown> | null,
    afterValue: Record<string, unknown> | null,
  ) {
    await this.agentAuditLogsRepository.save(
      this.agentAuditLogsRepository.create({
        agent,
        actor,
        action,
        beforeValue,
        afterValue,
      }),
    );
  }
}
