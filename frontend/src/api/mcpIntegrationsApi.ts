import { API_BASE } from '../config/api';
import { useAuthStore } from '../store/authStore';

export type MCPAppDirection = 'inbound' | 'outbound' | 'bidirectional';
export type MCPAppTransport = 'streamable-http' | 'http-jsonrpc';
export type MCPAppAuthMode = 'none' | 'bearer' | 'headers';
export type MCPHealthStatus = 'healthy' | 'warning' | 'failed' | 'unknown';
export type MCPToolDirection = 'external' | 'platform';
export type MCPInvocationDirection = 'inbound' | 'outbound';

export type MCPIntegrationApp = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  direction: MCPAppDirection;
  transport: MCPAppTransport;
  endpointUrl: string | null;
  authMode: MCPAppAuthMode;
  hasMcpToken: boolean;
  mcpTokenIssuedAt: string | null;
  defaultWorkspaceId: string | null;
  defaultTenantId: string | null;
  enabled: boolean;
  healthStatus: MCPHealthStatus;
  lastCheckedAt: string | null;
  lastDiscoveredAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  externalToolCount?: number;
  platformToolCount?: number;
};

export type MCPIntegrationTool = {
  id: string;
  appId: string;
  direction: MCPToolDirection;
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown> | null;
  isWrite: boolean;
  requiresIdempotency: boolean;
  enabled: boolean;
  permissionId?: string;
  rateLimitPerMinute?: number | null;
  lastSeenAt: string | null;
  lastCalledAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
};

export type MCPIntegrationCapability = {
  id: string;
  appId: string;
  capabilityType: 'workflow' | 'model' | 'skill';
  code: string;
  name: string;
  description: string | null;
  schemaJson: Record<string, unknown> | null;
  rawJson: Record<string, unknown> | null;
  enabled: boolean;
  lastSyncedAt: string | null;
};

export type MCPIntegrationInvocation = {
  id: string;
  appId: string;
  direction: MCPInvocationDirection;
  toolName: string;
  status: 'success' | 'failed';
  httpStatus: number | null;
  contentType: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  idempotencyKey: string | null;
  platformTaskId: string | null;
  platformOrderId: string | null;
  externalTaskId: string | null;
  createdAt: string;
  requestJson?: unknown;
  responseJson?: unknown;
};

export type MCPTaskBinding = {
  id: string;
  appId: string;
  platformTaskId: string | null;
  platformOrderId: string | null;
  externalTaskId: string | null;
  externalToolName: string | null;
  status: string | null;
  progress: string | null;
  resultUrl: string | null;
  resultJson: unknown;
  cost: number | null;
  errorMessage: string | null;
  lastPolledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MCPIntegrationExchange = {
  endpoint: string;
  ok: boolean;
  statusCode: number;
  durationMs: number;
  contentType: string;
  request: unknown;
  response: unknown;
  tools?: unknown[];
  result?: unknown;
};

export type MCPAppUpdateInput = Partial<
  Pick<
    MCPIntegrationApp,
    | 'name'
    | 'description'
    | 'direction'
    | 'transport'
    | 'endpointUrl'
    | 'authMode'
    | 'defaultWorkspaceId'
    | 'defaultTenantId'
    | 'enabled'
  >
>;

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

export async function fetchMCPIntegrationApps() {
  const response = await fetch(`${API_BASE}/api/v1/admin/mcp-integrations/apps`, {
    headers: adminHeaders(),
  });
  return parseResponse<{ data: MCPIntegrationApp[] }>(response);
}

export async function updateMCPIntegrationApp(
  id: string,
  input: MCPAppUpdateInput,
) {
  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/apps/${id}`,
    {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify(input),
    },
  );
  return parseResponse<{ data: MCPIntegrationApp }>(response);
}

export async function setMCPIntegrationAppEnabled(
  id: string,
  enabled: boolean,
) {
  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/apps/${id}/${enabled ? 'enable' : 'disable'}`,
    {
      method: 'POST',
      headers: adminHeaders(),
    },
  );
  return parseResponse<{ data: MCPIntegrationApp }>(response);
}

export async function issueMCPIntegrationInboundToken(id: string) {
  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/apps/${id}/token`,
    {
      method: 'POST',
      headers: adminHeaders(),
    },
  );
  return parseResponse<{ token: string; app: MCPIntegrationApp }>(response);
}

export async function discoverMCPIntegrationTools(id: string) {
  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/apps/${id}/discover-tools`,
    {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({}),
    },
  );
  return parseResponse<{
    app: MCPIntegrationApp;
    tools: MCPIntegrationTool[];
    exchange: MCPIntegrationExchange;
  }>(response);
}

export async function fetchMCPIntegrationTools(
  id: string,
  direction?: MCPToolDirection,
) {
  const params = new URLSearchParams();
  if (direction) params.set('direction', direction);
  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/apps/${id}/tools?${params}`,
    { headers: adminHeaders() },
  );
  return parseResponse<{ data: MCPIntegrationTool[] }>(response);
}

export async function updateMCPIntegrationTool(
  toolId: string,
  input: { enabled?: boolean },
) {
  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/tools/${toolId}`,
    {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify(input),
    },
  );
  return parseResponse<{ data: MCPIntegrationTool }>(response);
}

export async function fetchMCPIntegrationPlatformTools(id: string) {
  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/apps/${id}/platform-tools`,
    { headers: adminHeaders() },
  );
  return parseResponse<{ data: MCPIntegrationTool[] }>(response);
}

export async function updateMCPIntegrationPlatformTool(
  id: string,
  toolName: string,
  input: { enabled?: boolean; rateLimitPerMinute?: number | null },
) {
  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/apps/${id}/platform-tools/${encodeURIComponent(toolName)}`,
    {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify(input),
    },
  );
  return parseResponse<{ data: unknown }>(response);
}

export async function syncMCPIntegrationCapabilities(id: string) {
  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/apps/${id}/sync-capabilities`,
    {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({}),
    },
  );
  return parseResponse<{
    app: MCPIntegrationApp;
    capabilities: MCPIntegrationCapability[];
    exchange?: MCPIntegrationExchange;
    skipped?: boolean;
    message?: string;
  }>(response);
}

export async function fetchMCPIntegrationCapabilities(id: string) {
  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/apps/${id}/capabilities`,
    { headers: adminHeaders() },
  );
  return parseResponse<{ data: MCPIntegrationCapability[] }>(response);
}

export async function testMCPIntegrationExternalCall(
  id: string,
  input: {
    name: string;
    arguments: Record<string, unknown>;
    id?: string | number | null;
  },
) {
  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/apps/${id}/test/external-call`,
    {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(input),
    },
  );
  return parseResponse<MCPIntegrationExchange>(response);
}

export async function testMCPIntegrationPlatformCall(
  id: string,
  input: {
    name: string;
    arguments: Record<string, unknown>;
    id?: string | number | null;
  },
) {
  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/apps/${id}/test/platform-call`,
    {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(input),
    },
  );
  return parseResponse<unknown>(response);
}

export async function fetchMCPIntegrationInvocations(filters: {
  appId?: string;
  direction?: MCPInvocationDirection;
  toolName?: string;
  status?: string;
  page?: number;
  limit?: number;
} = {}) {
  const params = new URLSearchParams();
  params.set('page', String(filters.page || 1));
  params.set('limit', String(filters.limit || 20));
  if (filters.appId) params.set('appId', filters.appId);
  if (filters.direction) params.set('direction', filters.direction);
  if (filters.toolName) params.set('toolName', filters.toolName);
  if (filters.status) params.set('status', filters.status);

  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/invocations?${params}`,
    { headers: adminHeaders() },
  );
  return parseResponse<{
    data: MCPIntegrationInvocation[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }>(response);
}

export async function fetchMCPIntegrationInvocation(id: string) {
  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/invocations/${id}`,
    { headers: adminHeaders() },
  );
  return parseResponse<MCPIntegrationInvocation>(response);
}

export async function submitMCPIntegrationExternalTask(
  appId: string,
  input: {
    platformTaskId?: string | null;
    platformOrderId?: string | null;
    toolName?: string;
    arguments: Record<string, unknown>;
  },
) {
  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/apps/${appId}/task-bindings/submit`,
    {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(input),
    },
  );
  return parseResponse<{
    binding: MCPTaskBinding;
    exchange: MCPIntegrationExchange;
  }>(response);
}

export async function fetchMCPTaskBindings(filters: {
  appId?: string;
  platformTaskId?: string;
  platformOrderId?: string;
  externalTaskId?: string;
  page?: number;
  limit?: number;
} = {}) {
  const params = new URLSearchParams();
  params.set('page', String(filters.page || 1));
  params.set('limit', String(filters.limit || 20));
  if (filters.appId) params.set('appId', filters.appId);
  if (filters.platformTaskId) params.set('platformTaskId', filters.platformTaskId);
  if (filters.platformOrderId) params.set('platformOrderId', filters.platformOrderId);
  if (filters.externalTaskId) params.set('externalTaskId', filters.externalTaskId);

  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/task-bindings?${params}`,
    { headers: adminHeaders() },
  );
  return parseResponse<{
    data: MCPTaskBinding[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }>(response);
}

export async function pollMCPTaskBinding(
  bindingId: string,
  input: {
    statusToolName?: string;
    arguments?: Record<string, unknown>;
    deliverOnFinal?: boolean;
  } = {},
) {
  const response = await fetch(
    `${API_BASE}/api/v1/admin/mcp-integrations/task-bindings/${bindingId}/poll`,
    {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(input),
    },
  );
  return parseResponse<{
    binding: MCPTaskBinding;
    status: unknown;
    delivery: unknown;
    exchange: MCPIntegrationExchange;
  }>(response);
}
