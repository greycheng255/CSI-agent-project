import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import {
  MCPAppAuthMode,
  MCPAppDirection,
  MCPAppHealthStatus,
  MCPAppIntegration,
  MCPAppTool,
  MCPAppToolDirection,
  MCPAppTransport,
} from '../entities';

export type MCPAppUpsertInput = {
  code?: string;
  name?: string;
  description?: string | null;
  direction?: MCPAppDirection;
  transport?: MCPAppTransport;
  endpointUrl?: string | null;
  authMode?: MCPAppAuthMode;
  defaultWorkspaceId?: string | null;
  defaultTenantId?: string | null;
  enabled?: boolean;
};

@Injectable()
export class MCPAppRegistryService {
  constructor(
    @InjectRepository(MCPAppIntegration)
    private readonly appsRepository: Repository<MCPAppIntegration>,
    @InjectRepository(MCPAppTool)
    private readonly toolsRepository: Repository<MCPAppTool>,
  ) {}

  async ensureDefaultApps() {
    const defaults: MCPAppUpsertInput[] = [
      {
        code: 'opennotebook',
        name: 'OpenNotebook',
        description: '内容生成与媒体生成能力提供方',
        direction: MCPAppDirection.BIDIRECTIONAL,
        transport: MCPAppTransport.STREAMABLE_HTTP,
        endpointUrl: 'https://api.opennotebook.chat/api/v1/agent/mcp/',
        authMode: MCPAppAuthMode.NONE,
        enabled: true,
      },
      {
        code: 'hiclaw-controller',
        name: 'HiClaw Controller',
        description: '执行编排与任务控制器',
        direction: MCPAppDirection.BIDIRECTIONAL,
        transport: MCPAppTransport.STREAMABLE_HTTP,
        endpointUrl: '',
        authMode: MCPAppAuthMode.BEARER,
        enabled: true,
      },
    ];

    for (const item of defaults) {
      const existing = await this.appsRepository.findOne({
        where: { code: item.code },
      });
      if (existing) continue;
      await this.appsRepository.save(
        this.appsRepository.create({
          code: item.code,
          name: item.name,
          description: item.description || null,
          direction: item.direction,
          transport: item.transport,
          endpointUrl: item.endpointUrl || '',
          authMode: item.authMode,
          enabled: item.enabled ?? true,
          healthStatus: MCPAppHealthStatus.UNKNOWN,
        }),
      );
    }
  }

  async listApps() {
    await this.ensureDefaultApps();
    const apps = await this.appsRepository.find({
      order: { createdAt: 'ASC' },
    });

    const result = [];
    for (const app of apps) {
      const [externalToolCount, platformToolCount] = await Promise.all([
        this.toolsRepository.count({
          where: { appId: app.id, direction: MCPAppToolDirection.EXTERNAL },
        }),
        this.toolsRepository.count({
          where: { appId: app.id, direction: MCPAppToolDirection.PLATFORM },
        }),
      ]);
      result.push({
        ...this.serializeApp(app),
        externalToolCount,
        platformToolCount,
      });
    }
    return result;
  }

  async getApp(id: string) {
    await this.ensureDefaultApps();
    const app = await this.appsRepository.findOne({ where: { id } });
    if (!app) throw new NotFoundException('MCP app not found');
    return app;
  }

  async createApp(input: MCPAppUpsertInput) {
    if (!input.code?.trim()) {
      throw new BadRequestException('code is required');
    }

    const app = this.appsRepository.create({
      code: input.code.trim(),
      name: input.name?.trim() || input.code.trim(),
      description: input.description || null,
      direction: input.direction || MCPAppDirection.BIDIRECTIONAL,
      transport: input.transport || MCPAppTransport.STREAMABLE_HTTP,
      endpointUrl: input.endpointUrl || '',
      authMode: input.authMode || MCPAppAuthMode.NONE,
      defaultWorkspaceId: input.defaultWorkspaceId || null,
      defaultTenantId: input.defaultTenantId || null,
      enabled: input.enabled ?? true,
      healthStatus: MCPAppHealthStatus.UNKNOWN,
    });
    return this.appsRepository.save(app);
  }

  async updateApp(id: string, input: MCPAppUpsertInput) {
    const app = await this.getApp(id);
    if (input.name !== undefined) app.name = input.name;
    if (input.description !== undefined) app.description = input.description;
    if (input.direction !== undefined) app.direction = input.direction;
    if (input.transport !== undefined) app.transport = input.transport;
    if (input.endpointUrl !== undefined) app.endpointUrl = input.endpointUrl;
    if (input.authMode !== undefined) app.authMode = input.authMode;
    if (input.defaultWorkspaceId !== undefined) {
      app.defaultWorkspaceId = input.defaultWorkspaceId || null;
    }
    if (input.defaultTenantId !== undefined) {
      app.defaultTenantId = input.defaultTenantId || null;
    }
    if (input.enabled !== undefined) app.enabled = input.enabled;
    return this.appsRepository.save(app);
  }

  async setEnabled(id: string, enabled: boolean) {
    const app = await this.getApp(id);
    app.enabled = enabled;
    return this.appsRepository.save(app);
  }

  async issueInboundToken(id: string) {
    const app = await this.getApp(id);
    const token = `mcp_${app.code.replace(/[^a-zA-Z0-9_-]/g, '_')}_${randomBytes(24).toString('base64url')}`;
    app.mcpTokenHash = this.hashToken(token);
    app.mcpTokenIssuedAt = new Date();
    const saved = await this.appsRepository.save(app);
    return {
      token,
      app: this.serializeApp(saved),
    };
  }

  hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  serializeApp(app: MCPAppIntegration) {
    return {
      id: app.id,
      code: app.code,
      name: app.name,
      description: app.description,
      direction: app.direction,
      transport: app.transport,
      endpointUrl: app.endpointUrl,
      authMode: app.authMode,
      hasMcpToken: Boolean(app.mcpTokenHash),
      mcpTokenIssuedAt: app.mcpTokenIssuedAt,
      defaultWorkspaceId: app.defaultWorkspaceId,
      defaultTenantId: app.defaultTenantId,
      enabled: app.enabled,
      healthStatus: app.healthStatus,
      lastCheckedAt: app.lastCheckedAt,
      lastDiscoveredAt: app.lastDiscoveredAt,
      lastSyncedAt: app.lastSyncedAt,
      lastError: app.lastError,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    };
  }
}
