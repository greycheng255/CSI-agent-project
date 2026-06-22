import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  NotFoundException,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { MCPRequestDto } from './dto/mcp-request.dto';
import { MCPResponseDto, MCPResult } from './dto/mcp-response.dto';
import { MCPAuthGuard } from './mcp-auth.guard';
import { MCPAuditService } from './mcp-audit.service';
import { MCPExceptionFilter } from './mcp-exception.filter';
import { MCPIdempotencyService } from './mcp-idempotency.service';
import {
  MCPInvocationStatus,
  MCPToolInvocation,
} from './entities/mcp-tool-invocation.entity';
import { ToolRegistry } from './registry/tool-registry';
import { MCPAppIntegration, MCPAppToolPermission } from '../mcp-integrations/entities';
import { Agent } from '../agents/entities/agent.entity';

type MCPRequest = Request & {
  mcpApp?: MCPAppIntegration;
  mcpAgent?: Agent;
};

@Controller('mcp')
@UseFilters(MCPExceptionFilter)
export class MCPController {
  private readonly caller = 'hiclaw-controller';

  constructor(
    private readonly registry: ToolRegistry,
    private readonly audit: MCPAuditService,
    private readonly idempotency: MCPIdempotencyService,
    @InjectRepository(MCPAppToolPermission)
    private readonly permissionsRepository: Repository<MCPAppToolPermission>,
    @InjectRepository(MCPToolInvocation)
    private readonly invocationsRepository: Repository<MCPToolInvocation>,
  ) {}

  @Post()
  @UseGuards(MCPAuthGuard)
  async handle(
    @Req() req: MCPRequest,
    @Body() body: MCPRequestDto,
  ): Promise<MCPResponseDto> {
    const startedAt = Date.now();
    const args = body?.params?.arguments || {};
    const requestId =
      typeof args.request_id === 'string' ? args.request_id : undefined;
    const toolName = body?.params?.name || body?.method || 'unknown';
    const caller = this.callerFor(req.mcpApp);

    try {
      this.assertValidJsonRpc(body);

      if (body.method === 'initialize') {
        const result = this.result(
          true,
          {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'platform-mcp', version: '1.0.0' },
          },
          null,
          requestId,
        );
        await this.recordAudit({
          caller,
          toolName: 'initialize',
          requestId,
          input: (body.params || {}) as Record<string, unknown>,
          output: result.data,
          status: MCPInvocationStatus.SUCCESS,
          durationMs: Date.now() - startedAt,
        });
        return this.response(body, result);
      }

      if (body.method === 'notifications/initialized') {
        const result = this.result(true, {}, null, requestId);
        await this.recordAudit({
          caller,
          toolName: 'notifications/initialized',
          requestId,
          input: {},
          output: result.data,
          status: MCPInvocationStatus.SUCCESS,
          durationMs: Date.now() - startedAt,
        });
        return this.response(body, result);
      }

      if (body.method === 'tools/list') {
        const tools = req.mcpApp
          ? await this.listAllowedTools(req.mcpApp.id)
          : this.registry.listTools();
        const result = this.result(
          true,
          { tools },
          null,
          requestId,
        );
        await this.recordAudit({
          caller,
          toolName: 'tools/list',
          requestId,
          input: {},
          output: result.data,
          status: MCPInvocationStatus.SUCCESS,
          durationMs: Date.now() - startedAt,
        });
        return this.response(body, result);
      }

      if (body.method !== 'tools/call') {
        const result = this.result(
          false,
          null,
          {
            code: 'INVALID_METHOD',
            message: `Unknown method: ${body.method}`,
          },
          requestId,
        );
        await this.recordAudit({
          caller,
          toolName,
          requestId,
          input: args,
          output: result,
          status: MCPInvocationStatus.FAILED,
          errorMessage: result.error?.message,
          durationMs: Date.now() - startedAt,
        });
        return this.response(body, result);
      }

      const name = body.params?.name;
      if (!name) throw new BadRequestException('params.name is required');
      if (req.mcpApp) {
        await this.assertToolAllowed(req.mcpApp.id, name, caller);
      }

      const tool = this.registry.get(name);
      if (!tool) {
        const result = this.result(
          false,
          null,
          {
            code: 'TOOL_NOT_FOUND',
            message: `Tool '${name}' not found`,
          },
          requestId,
        );
        await this.recordAudit({
          caller,
          toolName: name,
          requestId,
          input: args,
          output: result,
          status: MCPInvocationStatus.FAILED,
          errorMessage: result.error?.message,
          durationMs: Date.now() - startedAt,
        });
        return this.response(body, result);
      }

      const idempotencyKey =
        typeof args.idempotency_key === 'string'
          ? args.idempotency_key.trim()
          : undefined;
      if (tool.isWrite && !idempotencyKey && !req.mcpAgent) {
        throw new BadRequestException('idempotency_key is required for write tools');
      }

      if (tool.isWrite && idempotencyKey) {
        const cached = await this.idempotency.getCachedResult(idempotencyKey);
        if (cached) {
          return this.response(body, this.result(true, cached, null, requestId));
        }
      }

      const result = await tool.execute(args, {
        caller,
        agentId: req.mcpAgent?.id || null,
        agentExternalId: req.mcpAgent?.externalId || null,
        ownerUserId: req.mcpAgent?.owner?.id || null,
        requestId,
        idempotencyKey,
      });

      await this.recordAudit({
        caller,
        toolName: name,
        requestId,
        idempotencyKey,
        input: args,
        output: result.data,
        status: result.success
          ? MCPInvocationStatus.SUCCESS
          : MCPInvocationStatus.FAILED,
        errorMessage: result.error?.message,
        durationMs: Date.now() - startedAt,
      });

      return this.response(body, result);
    } catch (error) {
      const mapped = this.mapError(error);
      const result = this.result(false, null, mapped, requestId);
      await this.recordAudit({
        caller,
        toolName,
        requestId,
        idempotencyKey:
          typeof args.idempotency_key === 'string'
            ? args.idempotency_key
            : undefined,
        input: args,
        output: result,
        status: MCPInvocationStatus.FAILED,
        errorMessage: mapped.message,
        durationMs: Date.now() - startedAt,
      });
      return this.response(body, result);
    }
  }

  private assertValidJsonRpc(body: MCPRequestDto) {
    if (!body || body.jsonrpc !== '2.0') {
      throw new BadRequestException('jsonrpc must be "2.0"');
    }
    if (!body.method) throw new BadRequestException('method is required');
  }

  private result(
    success: boolean,
    data: unknown,
    error: MCPResult['error'],
    requestId?: string,
  ): MCPResult {
    return {
      success,
      data,
      error,
      request_id: requestId || null,
    };
  }

  private response(body: MCPRequestDto, result: MCPResult): MCPResponseDto {
    return {
      jsonrpc: '2.0',
      result,
      id: body.id,
    };
  }

  private async recordAudit(input: {
    caller?: string;
    toolName: string;
    requestId?: string;
    idempotencyKey?: string;
    input?: Record<string, unknown>;
    output?: unknown;
    status: MCPInvocationStatus;
    errorMessage?: string | null;
    durationMs: number;
  }) {
    try {
      await this.audit.record({
        toolName: input.toolName,
        caller: input.caller || this.caller,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        input: input.input,
        output: input.output,
        status: input.status,
        errorMessage: input.errorMessage,
        durationMs: input.durationMs,
      });
    } catch (error) {
      if (input.idempotencyKey) {
        const cached = await this.idempotency.getCachedResult(input.idempotencyKey);
        if (cached) return;
      }
      throw error;
    }
  }

  private mapError(error: unknown) {
    if (error instanceof NotFoundException) {
      return { code: this.notFoundCode(error.message), message: error.message };
    }
    if (error instanceof BadRequestException) {
      if (error.message.includes('not allowed for this MCP app')) {
        return { code: 'TOOL_FORBIDDEN', message: error.message };
      }
      if (error.message.includes('Duplicate bid')) {
        return { code: 'DUPLICATE_BID', message: error.message };
      }
      if (error.message.includes('rate limit exceeded')) {
        return { code: 'RATE_LIMITED', message: error.message };
      }
      return { code: 'VALIDATION_ERROR', message: error.message };
    }
    if (error instanceof HttpException) {
      return {
        code: 'INTERNAL_ERROR',
        message: error.message,
        details: error.getResponse(),
      };
    }
    return {
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Internal error',
    };
  }

  private notFoundCode(message: string) {
    const normalized = message.toLowerCase();
    if (normalized.includes('agent')) return 'AGENT_NOT_FOUND';
    if (normalized.includes('task')) return 'TASK_NOT_FOUND';
    if (normalized.includes('order')) return 'ORDER_NOT_FOUND';
    return 'NOT_FOUND';
  }

  private callerFor(app?: MCPAppIntegration) {
    return app ? `mcp-app:${app.code}` : this.caller;
  }

  private async listAllowedTools(appId: string) {
    const permissions = await this.permissionsRepository.find({
      where: { appId, enabled: true },
    });
    const allowed = new Set(permissions.map((item) => item.toolName));
    return this.registry
      .listTools()
      .filter((tool) => allowed.has(tool.name));
  }

  private async assertToolAllowed(appId: string, toolName: string, caller: string) {
    const permission = await this.permissionsRepository.findOne({
      where: { appId, toolName, enabled: true },
    });
    if (!permission) {
      throw new BadRequestException(`Tool '${toolName}' is not allowed for this MCP app`);
    }
    if (permission.rateLimitPerMinute && permission.rateLimitPerMinute > 0) {
      const since = new Date(Date.now() - 60_000);
      const recentCalls = await this.invocationsRepository.count({
        where: {
          caller,
          toolName,
          createdAt: MoreThanOrEqual(since),
        },
      });
      if (recentCalls >= permission.rateLimitPerMinute) {
        throw new BadRequestException(
          `Tool '${toolName}' rate limit exceeded for this MCP app`,
        );
      }
    }
  }
}
