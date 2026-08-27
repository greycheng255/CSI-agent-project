import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ToolRegistry } from '../../mcp/registry/tool-registry';
import { MCPResult } from '../../mcp/dto/mcp-response.dto';
import { OrdersService } from '../../orders/orders.service';
import {
  MCPAppCapability,
  MCPAppCapabilityType,
  MCPAppHealthStatus,
  MCPAppIntegration,
  MCPAppInvocation,
  MCPAppInvocationDirection,
  MCPAppInvocationStatus,
  MCPAppTool,
  MCPAppToolDirection,
  MCPAppToolPermission,
  MCPTaskBinding,
} from '../entities';
import { MCPAppRegistryService } from './mcp-app-registry.service';
import { MCPClientService, MCPExternalExchange } from './mcp-client.service';

type ExternalCallInput = {
  name: string;
  arguments?: Record<string, unknown>;
  timeoutMs?: number;
  authConfig?: Record<string, unknown>;
  id?: string | number | null;
};

type PlatformCallInput = {
  name: string;
  arguments?: Record<string, unknown>;
  id?: string | number | null;
};

@Injectable()
export class MCPIntegrationsService {
  constructor(
    private readonly appRegistry: MCPAppRegistryService,
    private readonly mcpClient: MCPClientService,
    private readonly toolRegistry: ToolRegistry,
    private readonly ordersService: OrdersService,
    @InjectRepository(MCPAppIntegration)
    private readonly appsRepository: Repository<MCPAppIntegration>,
    @InjectRepository(MCPAppTool)
    private readonly toolsRepository: Repository<MCPAppTool>,
    @InjectRepository(MCPAppToolPermission)
    private readonly permissionsRepository: Repository<MCPAppToolPermission>,
    @InjectRepository(MCPAppCapability)
    private readonly capabilitiesRepository: Repository<MCPAppCapability>,
    @InjectRepository(MCPAppInvocation)
    private readonly invocationsRepository: Repository<MCPAppInvocation>,
    @InjectRepository(MCPTaskBinding)
    private readonly taskBindingsRepository: Repository<MCPTaskBinding>,
  ) {}

  async discoverTools(appId: string, authConfig?: Record<string, unknown>) {
    const app = await this.appRegistry.getApp(appId);
    const exchange = await this.mcpClient.listTools(app, {
      timeoutMs: 30000,
      authConfig,
    });
    const now = new Date();

    const tools = [];
    for (const rawTool of exchange.tools || []) {
      const tool = this.normalizeExternalTool(rawTool);
      if (!tool.name) continue;

      const existing = await this.toolsRepository.findOne({
        where: {
          appId: app.id,
          direction: MCPAppToolDirection.EXTERNAL,
          name: tool.name,
        },
      });
      const row =
        existing ||
        this.toolsRepository.create({
          appId: app.id,
          direction: MCPAppToolDirection.EXTERNAL,
          name: tool.name,
          enabled: true,
        });
      row.description = tool.description || null;
      row.inputSchema = tool.inputSchema || null;
      row.isWrite = this.isExternalWriteTool(tool.name);
      row.requiresIdempotency = false;
      row.lastSeenAt = now;
      row.lastStatus = exchange.ok ? 'success' : 'failed';
      row.lastError = exchange.ok ? null : this.extractErrorMessage(exchange.response);
      tools.push(await this.toolsRepository.save(row));
    }

    app.lastDiscoveredAt = now;
    app.lastCheckedAt = now;
    app.healthStatus = exchange.ok
      ? MCPAppHealthStatus.HEALTHY
      : MCPAppHealthStatus.FAILED;
    app.lastError = exchange.ok ? null : this.extractErrorMessage(exchange.response);
    await this.appsRepository.save(app);

    await this.recordInvocation({
      appId: app.id,
      direction: MCPAppInvocationDirection.OUTBOUND,
      toolName: 'tools/list',
      exchange,
    });

    return {
      app: this.appRegistry.serializeApp(app),
      tools: tools.map((tool) => this.serializeTool(tool)),
      exchange,
    };
  }

  async listTools(appId: string, direction?: MCPAppToolDirection) {
    await this.appRegistry.getApp(appId);
    const where: { appId: string; direction?: MCPAppToolDirection } = { appId };
    if (direction) where.direction = direction;
    const tools = await this.toolsRepository.find({
      where,
      order: { direction: 'ASC', name: 'ASC' },
    });
    return tools.map((tool) => this.serializeTool(tool));
  }

  async updateTool(toolId: string, input: { enabled?: boolean }) {
    const tool = await this.toolsRepository.findOne({ where: { id: toolId } });
    if (!tool) throw new NotFoundException('MCP app tool not found');
    if (input.enabled !== undefined) tool.enabled = input.enabled;
    return this.serializeTool(await this.toolsRepository.save(tool));
  }

  async listPlatformTools(appId: string) {
    const app = await this.appRegistry.getApp(appId);
    const platformTools = this.toolRegistry.listTools();
    const result = [];

    for (const platformTool of platformTools) {
      const permission = await this.ensurePlatformToolPermission(
        app.id,
        platformTool.name,
        true,
      );
      const toolRow = await this.ensurePlatformToolRow(app.id, platformTool);
      result.push({
        ...this.serializeTool(toolRow),
        enabled: permission.enabled,
        permissionId: permission.id,
        rateLimitPerMinute: permission.rateLimitPerMinute,
      });
    }

    return result;
  }

  async updatePlatformToolPermission(
    appId: string,
    toolName: string,
    input: { enabled?: boolean; rateLimitPerMinute?: number | null },
  ) {
    await this.appRegistry.getApp(appId);
    const permission = await this.ensurePlatformToolPermission(
      appId,
      toolName,
      true,
    );
    if (input.enabled !== undefined) permission.enabled = input.enabled;
    if (input.rateLimitPerMinute !== undefined) {
      permission.rateLimitPerMinute = input.rateLimitPerMinute;
    }
    await this.permissionsRepository.save(permission);
    return permission;
  }

  async syncCapabilities(appId: string, authConfig?: Record<string, unknown>) {
    const app = await this.appRegistry.getApp(appId);
    if (app.code !== 'opennotebook') {
      return {
        app: this.appRegistry.serializeApp(app),
        capabilities: await this.listCapabilities(app.id),
        skipped: true,
        message: '当前阶段仅 OpenNotebook 支持 catalog 同步',
      };
    }

    const exchange = await this.mcpClient.callTool(app, {
      name: 'opennotebook_agent_catalog',
      arguments: {},
      timeoutMs: 30000,
      authConfig,
    });
    await this.recordInvocation({
      appId: app.id,
      direction: MCPAppInvocationDirection.OUTBOUND,
      toolName: 'opennotebook_agent_catalog',
      exchange,
    });

    if (!exchange.ok) {
      app.healthStatus = MCPAppHealthStatus.FAILED;
      app.lastError = this.extractErrorMessage(exchange.response);
      app.lastCheckedAt = new Date();
      await this.appsRepository.save(app);
      return {
        app: this.appRegistry.serializeApp(app),
        capabilities: await this.listCapabilities(app.id),
        exchange,
      };
    }

    const structured = this.extractStructuredContent(exchange.result);
    const now = new Date();
    const saved = [];

    for (const agent of this.asArray(structured?.agents)) {
      const record = this.asRecord(agent);
      if (!record) continue;
      const code = String(record.type || record.name || '');
      if (!code) continue;
      saved.push(
        await this.upsertCapability(app.id, {
          type: MCPAppCapabilityType.WORKFLOW,
          code,
          name: String(record.label || code),
          description:
            typeof record.description === 'string' ? record.description : null,
          schemaJson: this.asRecord(record.params),
          rawJson: record,
          syncedAt: now,
        }),
      );
    }

    for (const model of this.asArray(structured?.models)) {
      const record = this.asRecord(model);
      if (!record) continue;
      const code = String(record.name || '');
      if (!code) continue;
      saved.push(
        await this.upsertCapability(app.id, {
          type: MCPAppCapabilityType.MODEL,
          code,
          name: String(record.label || code),
          description:
            typeof record.description === 'string' ? record.description : null,
          schemaJson: this.asRecord(record.params),
          rawJson: record,
          syncedAt: now,
        }),
      );
    }

    app.lastSyncedAt = now;
    app.lastCheckedAt = now;
    app.healthStatus = MCPAppHealthStatus.HEALTHY;
    app.lastError = null;
    await this.appsRepository.save(app);

    return {
      app: this.appRegistry.serializeApp(app),
      capabilities: saved.map((item) => this.serializeCapability(item)),
      exchange,
    };
  }

  async listCapabilities(appId: string) {
    await this.appRegistry.getApp(appId);
    const items = await this.capabilitiesRepository.find({
      where: { appId },
      order: { capabilityType: 'ASC', code: 'ASC' },
    });
    return items.map((item) => this.serializeCapability(item));
  }

  async testExternalCall(appId: string, input: ExternalCallInput) {
    const app = await this.appRegistry.getApp(appId);
    const exchange = await this.mcpClient.callTool(app, input);
    await this.recordInvocation({
      appId: app.id,
      direction: MCPAppInvocationDirection.OUTBOUND,
      toolName: input.name,
      exchange,
    });
    await this.markToolCall(
      app.id,
      MCPAppToolDirection.EXTERNAL,
      input.name,
      exchange.ok,
      this.extractErrorMessage(exchange.response),
    );
    return exchange;
  }

  async testPlatformCall(appId: string, input: PlatformCallInput) {
    const app = await this.appRegistry.getApp(appId);
    const permission = await this.permissionsRepository.findOne({
      where: { appId, toolName: input.name },
    });
    if (!permission?.enabled) {
      throw new BadRequestException('platform tool is not enabled for this app');
    }

    const tool = this.toolRegistry.get(input.name);
    if (!tool) throw new NotFoundException('platform tool not found');

    const startedAt = Date.now();
    const args = input.arguments || {};
    const requestId =
      typeof args.request_id === 'string' ? args.request_id : undefined;
    const idempotencyKey =
      typeof args.idempotency_key === 'string'
        ? args.idempotency_key.trim()
        : undefined;

    let result: MCPResult;
    try {
      if (tool.isWrite && !idempotencyKey) {
        throw new BadRequestException(
          'idempotency_key is required for write tools',
        );
      }
      result = await tool.execute(args, {
        caller: `mcp-app:${app.code}`,
        requestId,
        idempotencyKey,
      });
    } catch (error) {
      result = {
        success: false,
        data: null,
        error: {
          code: 'PLATFORM_TOOL_CALL_FAILED',
          message: error instanceof Error ? error.message : 'Platform call failed',
        },
        request_id: requestId || null,
      };
    }

    const response = {
      jsonrpc: '2.0',
      result,
      id: input.id ?? null,
      durationMs: Date.now() - startedAt,
    };
    await this.recordInvocation({
      appId: app.id,
      direction: MCPAppInvocationDirection.INBOUND,
      toolName: input.name,
      request: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: input.name, arguments: args },
        id: input.id ?? null,
      },
      response,
      ok: result.success,
      durationMs: response.durationMs,
      idempotencyKey,
      errorMessage: result.error?.message,
    });
    await this.markToolCall(
      app.id,
      MCPAppToolDirection.PLATFORM,
      input.name,
      result.success,
      result.error?.message,
    );
    return response;
  }

  async listInvocations(input: {
    page?: number;
    limit?: number;
    appId?: string;
    direction?: MCPAppInvocationDirection;
    toolName?: string;
    status?: MCPAppInvocationStatus;
  }) {
    const page = Math.max(input.page || 1, 1);
    const limit = Math.min(Math.max(input.limit || 20, 1), 100);
    const qb = this.invocationsRepository
      .createQueryBuilder('invocation')
      .orderBy('invocation.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (input.appId) {
      qb.andWhere('invocation.appId = :appId', { appId: input.appId });
    }
    if (input.direction) {
      qb.andWhere('invocation.direction = :direction', {
        direction: input.direction,
      });
    }
    if (input.toolName) {
      qb.andWhere('invocation.toolName = :toolName', {
        toolName: input.toolName,
      });
    }
    if (input.status) {
      qb.andWhere('invocation.status = :status', { status: input.status });
    }

    const [items, total] = await qb.getManyAndCount();
    return {
      data: items.map((item) => this.serializeInvocation(item, false)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getInvocation(id: string) {
    const item = await this.invocationsRepository.findOne({ where: { id } });
    if (!item) throw new NotFoundException('MCP app invocation not found');
    return this.serializeInvocation(item, true);
  }

  async submitExternalTask(
    appId: string,
    input: {
      platformTaskId?: string | null;
      platformOrderId?: string | null;
      toolName?: string;
      arguments?: Record<string, unknown>;
      timeoutMs?: number;
      authConfig?: Record<string, unknown>;
    },
  ) {
    const app = await this.appRegistry.getApp(appId);
    const toolName = input.toolName || this.defaultSubmitTool(app);
    const exchange = await this.mcpClient.callTool(app, {
      name: toolName,
      arguments: input.arguments || {},
      timeoutMs: input.timeoutMs || 30000,
      authConfig: input.authConfig,
    });

    const externalTaskId = this.extractExternalTaskId(exchange.result);
    await this.recordInvocation({
      appId: app.id,
      direction: MCPAppInvocationDirection.OUTBOUND,
      toolName,
      exchange,
      platformTaskId: input.platformTaskId || null,
      platformOrderId: input.platformOrderId || null,
      externalTaskId,
    });

    if (!exchange.ok) {
      throw new BadRequestException({
        code: 'EXTERNAL_TASK_SUBMIT_FAILED',
        message: this.extractErrorMessage(exchange.response) || 'External task submit failed',
        response: exchange.response,
      });
    }
    if (!externalTaskId) {
      throw new BadRequestException({
        code: 'EXTERNAL_TASK_ID_MISSING',
        message: 'External MCP response did not include task_id',
        response: exchange.response,
      });
    }

    const binding = await this.taskBindingsRepository.save(
      this.taskBindingsRepository.create({
        appId: app.id,
        platformTaskId: input.platformTaskId || null,
        platformOrderId: input.platformOrderId || null,
        externalTaskId,
        externalToolName: toolName,
        status: 'submitted',
        progress: null,
        resultUrl: null,
        resultJson: null,
        cost: null,
        errorMessage: null,
      }),
    );

    return {
      binding: this.serializeTaskBinding(binding),
      exchange,
    };
  }

  async listTaskBindings(input: {
    page?: number;
    limit?: number;
    appId?: string;
    platformTaskId?: string;
    platformOrderId?: string;
    externalTaskId?: string;
  }) {
    const page = Math.max(input.page || 1, 1);
    const limit = Math.min(Math.max(input.limit || 20, 1), 100);
    const qb = this.taskBindingsRepository
      .createQueryBuilder('binding')
      .orderBy('binding.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (input.appId) qb.andWhere('binding.appId = :appId', { appId: input.appId });
    if (input.platformTaskId) {
      qb.andWhere('binding.platformTaskId = :platformTaskId', {
        platformTaskId: input.platformTaskId,
      });
    }
    if (input.platformOrderId) {
      qb.andWhere('binding.platformOrderId = :platformOrderId', {
        platformOrderId: input.platformOrderId,
      });
    }
    if (input.externalTaskId) {
      qb.andWhere('binding.externalTaskId = :externalTaskId', {
        externalTaskId: input.externalTaskId,
      });
    }

    const [items, total] = await qb.getManyAndCount();
    return {
      data: items.map((item) => this.serializeTaskBinding(item)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async pollTaskBinding(
    bindingId: string,
    input: {
      statusToolName?: string;
      arguments?: Record<string, unknown>;
      timeoutMs?: number;
      authConfig?: Record<string, unknown>;
      deliverOnFinal?: boolean;
    } = {},
  ) {
    const binding = await this.taskBindingsRepository.findOne({
      where: { id: bindingId },
    });
    if (!binding) throw new NotFoundException('MCP task binding not found');
    const app = await this.appRegistry.getApp(binding.appId);
    if (!binding.externalTaskId) {
      throw new BadRequestException('external_task_id is required');
    }

    const toolName = input.statusToolName || this.defaultStatusTool(app);
    const args = input.arguments || this.defaultStatusArgs(app, binding.externalTaskId);
    const wasFinal = this.isFinalStatus(binding.status);
    const exchange = await this.mcpClient.callTool(app, {
      name: toolName,
      arguments: args,
      timeoutMs: input.timeoutMs || 30000,
      authConfig: input.authConfig,
    });
    const statusPayload = this.extractTaskStatusPayload(exchange.result);
    await this.recordInvocation({
      appId: app.id,
      direction: MCPAppInvocationDirection.OUTBOUND,
      toolName,
      exchange,
      platformTaskId: binding.platformTaskId,
      platformOrderId: binding.platformOrderId,
      externalTaskId: binding.externalTaskId,
    });

    binding.lastPolledAt = new Date();
    binding.status = statusPayload.status || (exchange.ok ? binding.status : 'error');
    binding.progress = statusPayload.progress || binding.progress;
    binding.resultUrl = statusPayload.resultUrl || binding.resultUrl;
    binding.resultJson = statusPayload.resultJson || binding.resultJson;
    binding.cost = statusPayload.cost ?? binding.cost;
    binding.errorMessage =
      statusPayload.error ||
      (exchange.ok ? null : this.extractErrorMessage(exchange.response));

    const saved = await this.taskBindingsRepository.save(binding);
    let delivery: unknown = null;
    if (
      input.deliverOnFinal !== false &&
      !wasFinal &&
      statusPayload.isFinal &&
      binding.platformOrderId &&
      !binding.errorMessage
    ) {
      delivery = await this.createDeliveryFromBinding(saved, statusPayload);
    }

    return {
      binding: this.serializeTaskBinding(saved),
      status: statusPayload,
      delivery,
      exchange,
    };
  }

  private normalizeExternalTool(rawTool: unknown) {
    const record = this.asRecord(rawTool);
    const inputSchema =
      this.asRecord(record?.inputSchema) ||
      this.asRecord(record?.input_schema) ||
      null;
    return {
      name: typeof record?.name === 'string' ? record.name : '',
      description:
        typeof record?.description === 'string' ? record.description : '',
      inputSchema,
    };
  }

  private isExternalWriteTool(name: string) {
    const normalized = name.toLowerCase();
    return (
      normalized.includes('generate') ||
      normalized.includes('approve') ||
      normalized.includes('submit') ||
      normalized.includes('create') ||
      normalized.includes('update') ||
      normalized.includes('attach')
    );
  }

  private async ensurePlatformToolRow(
    appId: string,
    platformTool: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      isWrite: boolean;
      requiresIdempotency: boolean;
    },
  ) {
    const existing = await this.toolsRepository.findOne({
      where: {
        appId,
        direction: MCPAppToolDirection.PLATFORM,
        name: platformTool.name,
      },
    });
    const row =
      existing ||
      this.toolsRepository.create({
        appId,
        direction: MCPAppToolDirection.PLATFORM,
        name: platformTool.name,
        enabled: true,
      });
    row.description = platformTool.description;
    row.inputSchema = platformTool.inputSchema;
    row.isWrite = platformTool.isWrite;
    row.requiresIdempotency = platformTool.requiresIdempotency;
    row.lastSeenAt = new Date();
    return this.toolsRepository.save(row);
  }

  private async ensurePlatformToolPermission(
    appId: string,
    toolName: string,
    enabled: boolean,
  ) {
    const existing = await this.permissionsRepository.findOne({
      where: { appId, toolName },
    });
    if (existing) return existing;
    return this.permissionsRepository.save(
      this.permissionsRepository.create({
        appId,
        toolName,
        enabled,
      }),
    );
  }

  private async upsertCapability(
    appId: string,
    input: {
      type: MCPAppCapabilityType;
      code: string;
      name: string;
      description: string | null;
      schemaJson: Record<string, unknown> | null;
      rawJson: Record<string, unknown>;
      syncedAt: Date;
    },
  ) {
    const existing = await this.capabilitiesRepository.findOne({
      where: {
        appId,
        capabilityType: input.type,
        code: input.code,
      },
    });
    const row =
      existing ||
      this.capabilitiesRepository.create({
        appId,
        capabilityType: input.type,
        code: input.code,
        enabled: true,
      });
    row.name = input.name;
    row.description = input.description;
    row.schemaJson = input.schemaJson;
    row.rawJson = input.rawJson;
    row.lastSyncedAt = input.syncedAt;
    return this.capabilitiesRepository.save(row);
  }

  private async recordInvocation(input: {
    appId: string;
    direction: MCPAppInvocationDirection;
    toolName: string;
    exchange?: MCPExternalExchange;
    request?: unknown;
    response?: unknown;
    ok?: boolean;
    durationMs?: number;
    idempotencyKey?: string | null;
    errorMessage?: string | null;
    platformTaskId?: string | null;
    platformOrderId?: string | null;
    externalTaskId?: string | null;
  }) {
    const ok = input.exchange?.ok ?? input.ok ?? false;
    return this.invocationsRepository.save(
      this.invocationsRepository.create({
        appId: input.appId,
        direction: input.direction,
        toolName: input.toolName,
        requestJson: input.exchange?.request ?? input.request ?? null,
        responseJson: input.exchange?.response ?? input.response ?? null,
        status: ok
          ? MCPAppInvocationStatus.SUCCESS
          : MCPAppInvocationStatus.FAILED,
        httpStatus: input.exchange?.statusCode ?? null,
        contentType: input.exchange?.contentType ?? null,
        durationMs: input.exchange?.durationMs ?? input.durationMs ?? null,
        idempotencyKey: input.idempotencyKey || null,
        platformTaskId: input.platformTaskId || null,
        platformOrderId: input.platformOrderId || null,
        externalTaskId: input.externalTaskId || null,
        errorMessage:
          input.errorMessage ||
          (input.exchange ? this.extractErrorMessage(input.exchange.response) : null),
      }),
    );
  }

  private async markToolCall(
    appId: string,
    direction: MCPAppToolDirection,
    name: string,
    ok: boolean,
    error?: string | null,
  ) {
    const tool = await this.toolsRepository.findOne({
      where: { appId, direction, name },
    });
    if (!tool) return;
    tool.lastCalledAt = new Date();
    tool.lastStatus = ok ? 'success' : 'failed';
    tool.lastError = ok ? null : error || null;
    await this.toolsRepository.save(tool);
  }

  private extractStructuredContent(result: unknown) {
    const record = this.asRecord(result);
    const structured = this.asRecord(record?.structuredContent);
    if (structured) return structured;

    const content = Array.isArray(record?.content) ? record.content : [];
    for (const item of content) {
      const itemRecord = this.asRecord(item);
      if (typeof itemRecord?.text !== 'string') continue;
      try {
        const parsed = JSON.parse(itemRecord.text) as unknown;
        const parsedRecord = this.asRecord(parsed);
        if (parsedRecord) return parsedRecord;
      } catch {
        continue;
      }
    }
    return null;
  }

  private defaultSubmitTool(app: { code: string }) {
    if (app.code === 'opennotebook') return 'opennotebook_agent_generate';
    if (app.code === 'hiclaw-controller') return 'hiclaw_task_submit';
    throw new BadRequestException('toolName is required for this MCP app');
  }

  private defaultStatusTool(app: { code: string }) {
    if (app.code === 'opennotebook') return 'opennotebook_agent_status';
    if (app.code === 'hiclaw-controller') return 'hiclaw_execution_status';
    throw new BadRequestException('statusToolName is required for this MCP app');
  }

  private defaultStatusArgs(app: { code: string }, externalTaskId: string) {
    if (app.code === 'opennotebook') return { task_id: externalTaskId };
    return { external_task_id: externalTaskId };
  }

  private extractExternalTaskId(result: unknown) {
    const payload = this.extractStructuredContent(result) || this.asRecord(result);
    const data = this.asRecord(payload?.data);
    const candidates = [
      payload?.task_id,
      payload?.taskId,
      payload?.external_task_id,
      payload?.externalTaskId,
      data?.task_id,
      data?.taskId,
      data?.external_task_id,
      data?.externalTaskId,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    return null;
  }

  private extractTaskStatusPayload(result: unknown) {
    const payload = this.extractStructuredContent(result) || this.asRecord(result);
    const data = this.asRecord(payload?.data) || payload || {};
    const resultJson =
      data.result_data !== undefined
        ? data.result_data
        : data.structured_result !== undefined
          ? data.structured_result
          : data.resultJson;
    const status = this.stringValue(data.status || payload?.status);
    const isFinal =
      this.booleanValue(data.is_final) ||
      ['done', 'completed', 'success', 'failed', 'error'].includes(
        (status || '').toLowerCase(),
      );
    return {
      status,
      isFinal,
      progress: this.stringValue(data.progress),
      resultUrl: this.stringValue(data.result_url || data.resultUrl),
      resultJson: resultJson === undefined ? null : resultJson,
      resultType: this.stringValue(data.result_type || data.resultType),
      currentStep: this.stringValue(data.current_step || data.currentStep),
      cost: this.numberValue(data.cost),
      error: this.stringValue(data.error || payload?.error),
      raw: payload,
    };
  }

  private async createDeliveryFromBinding(
    binding: MCPTaskBinding,
    statusPayload: ReturnType<MCPIntegrationsService['extractTaskStatusPayload']>,
  ) {
    if (!binding.platformOrderId) return null;
    const order = await this.ordersService.findOne(binding.platformOrderId);
    const ownerUserId =
      typeof order.owner?.id === 'string'
        ? order.owner.id
        : typeof order.ownerUserId === 'string'
          ? order.ownerUserId
          : null;
    if (!ownerUserId) {
      throw new BadRequestException('Order has no owner for MCP delivery');
    }

    const artifactUrls = statusPayload.resultUrl ? [statusPayload.resultUrl] : [];
    return this.ordersService.deliver(binding.platformOrderId, ownerUserId, {
      deliverySummary: `MCP 外部任务 ${binding.externalTaskId} 已完成`,
      deliveryUrl: statusPayload.resultUrl || undefined,
      artifactUrls,
      evidenceBundle: {
        source: 'mcp-integration',
        appId: binding.appId,
        externalTaskId: binding.externalTaskId,
        status: statusPayload.status,
        progress: statusPayload.progress,
        cost: statusPayload.cost,
        resultType: statusPayload.resultType,
        resultJson: statusPayload.resultJson,
        raw: statusPayload.raw,
      },
      previewData: statusPayload.resultUrl
        ? {
            type: 'link',
            content: statusPayload.resultUrl,
          }
        : statusPayload.resultJson
          ? {
              type: 'text',
              content: stringifySafe(statusPayload.resultJson),
            }
          : undefined,
    });
  }

  private isFinalStatus(status?: string | null) {
    return ['done', 'completed', 'success', 'failed', 'error'].includes(
      (status || '').toLowerCase(),
    );
  }

  private stringValue(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private booleanValue(value: unknown) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return false;
  }

  private numberValue(value: unknown) {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  }

  private extractErrorMessage(response: unknown) {
    const record = this.asRecord(response);
    const error = this.asRecord(record?.error);
    if (typeof error?.message === 'string') return error.message;
    const result = this.asRecord(record?.result);
    const resultError = this.asRecord(result?.error);
    if (typeof resultError?.message === 'string') return resultError.message;
    const content = Array.isArray(result?.content) ? result.content : [];
    const firstText = this.asRecord(content[0]);
    if (typeof firstText?.text === 'string' && result?.isError === true) {
      return firstText.text;
    }
    return null;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private asArray(value: unknown) {
    return Array.isArray(value) ? value : [];
  }

  private serializeTool(tool: MCPAppTool) {
    return {
      id: tool.id,
      appId: tool.appId,
      direction: tool.direction,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      isWrite: tool.isWrite,
      requiresIdempotency: tool.requiresIdempotency,
      enabled: tool.enabled,
      lastSeenAt: tool.lastSeenAt,
      lastCalledAt: tool.lastCalledAt,
      lastStatus: tool.lastStatus,
      lastError: tool.lastError,
      createdAt: tool.createdAt,
      updatedAt: tool.updatedAt,
    };
  }

  private serializeCapability(item: MCPAppCapability) {
    return {
      id: item.id,
      appId: item.appId,
      capabilityType: item.capabilityType,
      code: item.code,
      name: item.name,
      description: item.description,
      schemaJson: item.schemaJson,
      rawJson: item.rawJson,
      enabled: item.enabled,
      lastSyncedAt: item.lastSyncedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private serializeInvocation(item: MCPAppInvocation, includePayloads: boolean) {
    return {
      id: item.id,
      appId: item.appId,
      direction: item.direction,
      toolName: item.toolName,
      status: item.status,
      httpStatus: item.httpStatus,
      contentType: item.contentType,
      durationMs: item.durationMs,
      errorMessage: item.errorMessage,
      idempotencyKey: item.idempotencyKey,
      platformTaskId: item.platformTaskId,
      platformOrderId: item.platformOrderId,
      externalTaskId: item.externalTaskId,
      createdAt: item.createdAt,
      requestJson: includePayloads ? item.requestJson : undefined,
      responseJson: includePayloads ? item.responseJson : undefined,
    };
  }

  private serializeTaskBinding(item: MCPTaskBinding) {
    return {
      id: item.id,
      appId: item.appId,
      platformTaskId: item.platformTaskId,
      platformOrderId: item.platformOrderId,
      externalTaskId: item.externalTaskId,
      externalToolName: item.externalToolName,
      status: item.status,
      progress: item.progress,
      resultUrl: item.resultUrl,
      resultJson: item.resultJson,
      cost: item.cost,
      errorMessage: item.errorMessage,
      lastPolledAt: item.lastPolledAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}

function stringifySafe(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
