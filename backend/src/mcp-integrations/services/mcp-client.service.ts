import { BadRequestException, Injectable } from '@nestjs/common';
import axios from 'axios';
import { MCPAppAuthMode, MCPAppIntegration } from '../entities';

export type MCPJsonRpcRequest = {
  jsonrpc: '2.0';
  method: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
  id?: string | number | null;
};

export type MCPExternalExchange = {
  endpoint: string;
  ok: boolean;
  statusCode: number;
  durationMs: number;
  contentType: string;
  request: MCPJsonRpcRequest;
  response: unknown;
  tools?: unknown[];
  result?: unknown;
};

@Injectable()
export class MCPClientService {
  async listTools(
    app: MCPAppIntegration,
    options: {
      timeoutMs?: number;
      authConfig?: Record<string, unknown>;
      id?: string | number | null;
    } = {},
  ) {
    const request: MCPJsonRpcRequest = {
      jsonrpc: '2.0',
      method: 'tools/list',
      id: options.id ?? `tools-list-${Date.now()}`,
    };
    const exchange = await this.exchange(app, request, options);
    return {
      ...exchange,
      tools: this.extractTools(exchange.response),
    };
  }

  async callTool(
    app: MCPAppIntegration,
    input: {
      name: string;
      arguments?: Record<string, unknown>;
      timeoutMs?: number;
      authConfig?: Record<string, unknown>;
      id?: string | number | null;
    },
  ) {
    if (!input.name?.trim()) {
      throw new BadRequestException('name is required');
    }

    const request: MCPJsonRpcRequest = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: input.name.trim(),
        arguments: input.arguments || {},
      },
      id: input.id ?? `tools-call-${Date.now()}`,
    };
    const exchange = await this.exchange(app, request, input);
    const record = this.asRecord(exchange.response);
    return {
      ...exchange,
      result: record?.result ?? null,
    };
  }

  private async exchange(
    app: MCPAppIntegration,
    request: MCPJsonRpcRequest,
    options: {
      timeoutMs?: number;
      authConfig?: Record<string, unknown>;
    },
  ): Promise<MCPExternalExchange> {
    const endpoint = this.normalizeEndpoint(app.endpointUrl);
    const startedAt = Date.now();

    try {
      const response = await axios.post(endpoint, request, {
        headers: this.buildHeaders(app, options.authConfig),
        responseType: 'text',
        timeout: this.normalizeTimeout(options.timeoutMs),
        transformResponse: [(data) => data],
        validateStatus: () => true,
      });
      const parsed = this.parseResponse(response.data);

      return {
        endpoint,
        ok:
          response.status >= 200 &&
          response.status < 300 &&
          !this.hasMCPError(parsed),
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

  private normalizeEndpoint(endpoint?: string | null) {
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

  private buildHeaders(
    app: MCPAppIntegration,
    authConfig?: Record<string, unknown>,
  ) {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    };

    if (app.authMode === MCPAppAuthMode.BEARER) {
      const token =
        typeof authConfig?.bearerToken === 'string'
          ? authConfig.bearerToken.trim()
          : '';
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    if (app.authMode === MCPAppAuthMode.HEADERS) {
      const customHeaders = this.asRecord(authConfig?.headers);
      for (const [key, value] of Object.entries(customHeaders || {})) {
        if (key.trim()) headers[key.trim()] = String(value);
      }
    }

    return headers;
  }

  private parseResponse(raw: unknown) {
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

  private extractTools(response: unknown) {
    const record = this.asRecord(response);
    const result = this.asRecord(record?.result);
    const data = this.asRecord(result?.data);

    if (Array.isArray(result?.tools)) return result.tools;
    if (Array.isArray(data?.tools)) return data.tools;
    return [];
  }

  private hasMCPError(response: unknown) {
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
