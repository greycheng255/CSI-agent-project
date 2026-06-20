import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import axios from 'axios';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SuperAdminGuard } from './admin.guard';
import { Admin } from './entities/admin.entity';
import { ToolRegistry } from '../mcp/registry/tool-registry';
import { MCPAuditService } from '../mcp/mcp-audit.service';
import { MCPIdempotencyService } from '../mcp/mcp-idempotency.service';
import {
  MCPInvocationStatus,
  MCPToolInvocation,
} from '../mcp/entities/mcp-tool-invocation.entity';
import { MCPErrorPayload, MCPResult } from '../mcp/dto/mcp-response.dto';

type AdminMCPCallBody = {
  name: string;
  arguments?: Record<string, unknown>;
  id?: string | number | null;
};

type AdminRequest = Request & {
  admin: Admin;
};

type AdminMCPExternalBaseBody = {
  endpoint: string;
  authMode?: 'none' | 'bearer' | 'headers';
  bearerToken?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  id?: string | number | null;
};

type AdminMCPExternalCallBody = AdminMCPExternalBaseBody & {
  name: string;
  arguments?: Record<string, unknown>;
};

type ExternalJsonRpcRequest = {
  jsonrpc: '2.0';
  method: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
  id?: string | number | null;
};

@Controller('api/v1/admin/mcp')
@UseGuards(SuperAdminGuard)
export class AdminMCPController {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly audit: MCPAuditService,
    private readonly idempotency: MCPIdempotencyService,
    @InjectRepository(MCPToolInvocation)
    private readonly invocationsRepository: Repository<MCPToolInvocation>,
  ) {}

  @Get('tools')
  listTools() {
    return {
      tools: this.registry.listTools(),
    };
  }

  @Post('external/tools')
  async listExternalTools(@Body() body: AdminMCPExternalBaseBody) {
    const request: ExternalJsonRpcRequest = {
      jsonrpc: '2.0',
      method: 'tools/list',
      id: body.id ?? `tools-list-${Date.now()}`,
    };
    const exchange = await this.exchangeExternal(body, request);
    return {
      ...exchange,
      tools: this.extractExternalTools(exchange.response),
    };
  }

  @Post('external/call')
  async callExternalTool(@Body() body: AdminMCPExternalCallBody) {
    if (!body.name?.trim()) {
      throw new BadRequestException('name is required');
    }

    const request: ExternalJsonRpcRequest = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: body.name.trim(),
        arguments: body.arguments || {},
      },
      id: body.id ?? `tools-call-${Date.now()}`,
    };
    const exchange = await this.exchangeExternal(body, request);
    const record = this.asRecord(exchange.response);
    return {
      ...exchange,
      result: record?.result ?? null,
    };
  }

  @Post('call')
  async callTool(@Req() req: AdminRequest, @Body() body: AdminMCPCallBody) {
    const startedAt = Date.now();
    const admin = req.admin as Admin;
    const args = body.arguments || {};
    const requestId =
      typeof args.request_id === 'string' ? args.request_id : undefined;
    const idempotencyKey =
      typeof args.idempotency_key === 'string'
        ? args.idempotency_key.trim()
        : undefined;
    const toolName = body.name || 'unknown';
    const caller = `admin:${admin.id}`;

    try {
      if (!body.name) {
        throw new BadRequestException('name is required');
      }

      const tool = this.registry.get(body.name);
      if (!tool) {
        const result = this.result(false, null, {
          code: 'TOOL_NOT_FOUND',
          message: `Tool '${body.name}' not found`,
        }, requestId);
        const invocation = await this.record({
          toolName,
          caller,
          requestId,
          input: args,
          output: result,
          status: MCPInvocationStatus.FAILED,
          errorMessage: result.error?.message,
          durationMs: Date.now() - startedAt,
        });
        return this.response(body, result, invocation.id, Date.now() - startedAt);
      }

      if (tool.isWrite && !idempotencyKey) {
        throw new BadRequestException(
          'idempotency_key is required for write tools',
        );
      }

      if (tool.isWrite && idempotencyKey) {
        const cached = await this.idempotency.getCachedResult(idempotencyKey);
        if (cached) {
          return {
            ...this.response(
              body,
              {
                ...this.result(true, cached, null, requestId),
                cached: true,
              } as MCPResult & { cached: boolean },
              null,
              Date.now() - startedAt,
            ),
            cached: true,
          };
        }
      }

      const result = await tool.execute(args, {
        caller,
        requestId,
        idempotencyKey,
      });
      const invocation = await this.record({
        toolName: tool.name,
        caller,
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

      return this.response(
        body,
        result,
        invocation.id,
        Date.now() - startedAt,
      );
    } catch (error) {
      const mapped = this.mapError(error);
      const result = this.result(false, null, mapped, requestId);
      const invocation = await this.record({
        toolName,
        caller,
        requestId,
        idempotencyKey,
        input: args,
        output: result,
        status: MCPInvocationStatus.FAILED,
        errorMessage: mapped.message,
        durationMs: Date.now() - startedAt,
      });
      return this.response(body, result, invocation.id, Date.now() - startedAt);
    }
  }

  @Get('invocations')
  async listInvocations(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('toolName') toolName?: string,
    @Query('status') status?: MCPInvocationStatus,
    @Query('requestId') requestId?: string,
    @Query('idempotencyKey') idempotencyKey?: string,
    @Query('caller') caller?: string,
  ) {
    const p = Math.max(parseInt(page || '1', 10), 1);
    const l = Math.min(Math.max(parseInt(limit || '20', 10), 1), 100);
    const qb = this.invocationsRepository
      .createQueryBuilder('invocation')
      .orderBy('invocation.createdAt', 'DESC')
      .skip((p - 1) * l)
      .take(l);

    if (toolName) {
      qb.andWhere('invocation.toolName = :toolName', { toolName });
    }
    if (status) {
      qb.andWhere('invocation.status = :status', { status });
    }
    if (requestId) {
      qb.andWhere('invocation.requestId LIKE :requestId', {
        requestId: `%${requestId}%`,
      });
    }
    if (idempotencyKey) {
      qb.andWhere('invocation.idempotencyKey LIKE :idempotencyKey', {
        idempotencyKey: `%${idempotencyKey}%`,
      });
    }
    if (caller) {
      qb.andWhere('invocation.caller LIKE :caller', { caller: `%${caller}%` });
    }

    const [items, total] = await qb.getManyAndCount();
    return {
      data: items.map((item) => this.serializeInvocation(item, false)),
      pagination: {
        page: p,
        limit: l,
        total,
        totalPages: Math.ceil(total / l),
      },
    };
  }

  @Get('invocations/:id')
  async getInvocation(@Param('id') id: string) {
    const invocation = await this.invocationsRepository.findOne({
      where: { id },
    });
    if (!invocation) {
      throw new NotFoundException('MCP invocation not found');
    }
    return this.serializeInvocation(invocation, true);
  }

  private result(
    success: boolean,
    data: unknown,
    error: MCPErrorPayload | null,
    requestId?: string,
  ): MCPResult {
    return {
      success,
      data,
      error,
      request_id: requestId || null,
    };
  }

  private response(
    body: AdminMCPCallBody,
    result: MCPResult,
    invocationId: string | null,
    durationMs: number,
  ) {
    return {
      jsonrpc: '2.0',
      result,
      id: body.id ?? null,
      invocationId,
      durationMs,
    };
  }

  private async record(input: {
    toolName: string;
    caller: string;
    requestId?: string;
    idempotencyKey?: string;
    input?: Record<string, unknown>;
    output?: unknown;
    status: MCPInvocationStatus;
    errorMessage?: string | null;
    durationMs: number;
  }) {
    try {
      return await this.audit.record(input);
    } catch (error) {
      if (input.idempotencyKey) {
        const existing = await this.invocationsRepository.findOne({
          where: { idempotencyKey: input.idempotencyKey },
          order: { createdAt: 'DESC' },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  private mapError(error: unknown): MCPErrorPayload {
    if (error instanceof NotFoundException) {
      return { code: this.notFoundCode(error.message), message: error.message };
    }
    if (error instanceof BadRequestException) {
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

  private serializeInvocation(
    invocation: MCPToolInvocation,
    includePayloads: boolean,
  ) {
    return {
      id: invocation.id,
      toolName: invocation.toolName,
      caller: invocation.caller,
      requestId: invocation.requestId,
      idempotencyKey: invocation.idempotencyKey,
      status: invocation.status,
      errorMessage: invocation.errorMessage,
      durationMs: invocation.durationMs,
      createdAt: invocation.createdAt,
      inputJson: includePayloads ? invocation.inputJson : undefined,
      outputJson: includePayloads ? invocation.outputJson : undefined,
    };
  }

  private async exchangeExternal(
    body: AdminMCPExternalBaseBody,
    request: ExternalJsonRpcRequest,
  ) {
    const endpoint = this.normalizeExternalEndpoint(body.endpoint);
    const startedAt = Date.now();

    try {
      const response = await axios.post(endpoint, request, {
        headers: this.buildExternalHeaders(body),
        responseType: 'text',
        timeout: this.normalizeTimeout(body.timeoutMs),
        transformResponse: [(data) => data],
        validateStatus: () => true,
      });
      const parsed = this.parseExternalResponse(response.data);

      return {
        endpoint,
        ok:
          response.status >= 200 &&
          response.status < 300 &&
          !this.hasJsonRpcError(parsed),
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
        contentType: String(response.headers['content-type'] || ''),
        request,
        response: parsed,
      };
    } catch (error) {
      throw new BadRequestException({
        code: 'EXTERNAL_MCP_CONNECT_FAILED',
        message:
          error instanceof Error
            ? error.message
            : 'External MCP connection failed',
      });
    }
  }

  private normalizeExternalEndpoint(endpoint?: string) {
    if (!endpoint?.trim()) {
      throw new BadRequestException('endpoint is required');
    }

    let parsed: URL;
    try {
      parsed = new URL(endpoint.trim());
    } catch {
      throw new BadRequestException('endpoint must be a valid URL');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('endpoint must use http or https');
    }

    return parsed.toString();
  }

  private normalizeTimeout(timeoutMs?: number) {
    if (!timeoutMs || Number.isNaN(timeoutMs)) return 10000;
    return Math.min(Math.max(timeoutMs, 1000), 30000);
  }

  private buildExternalHeaders(body: AdminMCPExternalBaseBody) {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    };

    if (body.authMode === 'bearer') {
      const token = body.bearerToken?.trim();
      if (!token) {
        throw new BadRequestException('bearerToken is required');
      }
      headers.Authorization = `Bearer ${token}`;
    }

    for (const [key, value] of Object.entries(body.headers || {})) {
      if (key.trim() && typeof value === 'string') {
        headers[key.trim()] = value;
      }
    }

    return headers;
  }

  private parseExternalResponse(raw: unknown) {
    if (typeof raw !== 'string') return raw;

    const trimmed = raw.trim();
    if (!trimmed) return null;

    const ssePayload = this.parseEventStreamPayload(trimmed);
    if (ssePayload !== undefined) return ssePayload;

    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return { rawText: trimmed };
    }
  }

  private parseEventStreamPayload(raw: string) {
    const dataLines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== '[DONE]');

    for (const line of dataLines) {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private extractExternalTools(response: unknown) {
    const record = this.asRecord(response);
    const result = this.asRecord(record?.result);
    const data = this.asRecord(result?.data);
    const directTools = result?.tools;
    const wrappedTools = data?.tools;

    if (Array.isArray(directTools)) return directTools;
    if (Array.isArray(wrappedTools)) return wrappedTools;
    return [];
  }

  private hasJsonRpcError(response: unknown) {
    const record = this.asRecord(response);
    const result = this.asRecord(record?.result);
    return Boolean(record?.error || result?.error || result?.isError === true);
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
