import { API_BASE } from '../config/api';
import { useAuthStore } from '../store/authStore';

export type AdminMCPTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  isWrite: boolean;
  requiresIdempotency: boolean;
};

export type AdminMCPInvocation = {
  id: string;
  toolName: string;
  caller: string;
  requestId: string | null;
  idempotencyKey: string | null;
  status: 'success' | 'failed';
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
  inputJson?: unknown;
  outputJson?: unknown;
};

export type AdminMCPCallResponse = {
  jsonrpc: '2.0';
  result: {
    success: boolean;
    data: unknown;
    error: { code: string; message: string; details?: unknown } | null;
    request_id?: string | null;
    cached?: boolean;
  };
  id: string | number | null;
  invocationId: string | null;
  durationMs: number;
  cached?: boolean;
};

export type AdminMCPExternalTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  [key: string]: unknown;
};

export type AdminMCPExternalConnection = {
  endpoint: string;
  authMode?: 'none' | 'bearer' | 'headers';
  bearerToken?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  id?: string | number | null;
};

export type AdminMCPExternalExchange = {
  endpoint: string;
  ok: boolean;
  statusCode: number;
  durationMs: number;
  contentType: string;
  request: unknown;
  response: unknown;
  tools?: AdminMCPExternalTool[];
  result?: unknown;
};

type InvocationFilters = {
  page?: number;
  limit?: number;
  toolName?: string;
  status?: string;
  requestId?: string;
  idempotencyKey?: string;
  caller?: string;
};

function adminHeaders() {
  const token = useAuthStore.getState().adminToken;
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || `HTTP ${response.status}`);
  }
  return data as T;
}

export async function fetchAdminMCPTools() {
  const response = await fetch(`${API_BASE}/api/v1/admin/mcp/tools`, {
    headers: adminHeaders(),
  });
  return parseResponse<{ tools: AdminMCPTool[] }>(response);
}

export async function callAdminMCPTool(input: {
  name: string;
  arguments: Record<string, unknown>;
  id?: string | number | null;
}) {
  const response = await fetch(`${API_BASE}/api/v1/admin/mcp/call`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(input),
  });
  return parseResponse<AdminMCPCallResponse>(response);
}

export async function fetchAdminMCPInvocations(filters: InvocationFilters = {}) {
  const params = new URLSearchParams();
  params.set('page', String(filters.page || 1));
  params.set('limit', String(filters.limit || 20));
  if (filters.toolName) params.set('toolName', filters.toolName);
  if (filters.status) params.set('status', filters.status);
  if (filters.requestId) params.set('requestId', filters.requestId);
  if (filters.idempotencyKey) {
    params.set('idempotencyKey', filters.idempotencyKey);
  }
  if (filters.caller) params.set('caller', filters.caller);

  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp/invocations?${params}`,
    { headers: adminHeaders() },
  );
  return parseResponse<{
    data: AdminMCPInvocation[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }>(response);
}

export async function fetchAdminMCPInvocation(id: string) {
  const response = await fetch(`${API_BASE}/api/v1/admin/mcp/invocations/${id}`, {
    headers: adminHeaders(),
  });
  return parseResponse<AdminMCPInvocation>(response);
}

export async function fetchAdminMCPExternalTools(
  input: AdminMCPExternalConnection,
) {
  const response = await fetch(`${API_BASE}/api/v1/admin/mcp/external/tools`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(input),
  });
  return parseResponse<AdminMCPExternalExchange>(response);
}

export async function callAdminMCPExternalTool(
  input: AdminMCPExternalConnection & {
    name: string;
    arguments: Record<string, unknown>;
  },
) {
  const response = await fetch(`${API_BASE}/api/v1/admin/mcp/external/call`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(input),
  });
  return parseResponse<AdminMCPExternalExchange>(response);
}
