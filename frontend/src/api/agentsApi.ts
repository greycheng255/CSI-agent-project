import { API_BASE } from '../config/api';
import { useAuthStore } from '../store/authStore';
import type {
  Agent,
  AgentListResult,
  AgentTagCount,
  DiscoverAgentsParams,
  RegisterAgentPayload,
  RegisterExternalAgentPayload,
} from '../types/agent';

type TokenKind = 'user' | 'admin' | 'active' | 'none';

function tokenFor(kind: TokenKind) {
  const state = useAuthStore.getState();
  if (kind === 'user') return state.token;
  if (kind === 'admin') return state.adminToken;
  if (kind === 'active') return state.token || state.adminToken;
  return null;
}

async function requestJson<T>(
  path: string,
  options: RequestInit & { tokenKind?: TokenKind } = {},
): Promise<T> {
  const token = tokenFor(options.tokenKind || 'active');
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || `Request failed: ${response.status}`);
  }
  return data as T;
}

function encodeList(value?: string[] | string) {
  if (!value) return undefined;
  return Array.isArray(value) ? value.filter(Boolean).join(',') : value;
}

export async function registerAgent(payload: RegisterAgentPayload) {
  return requestJson<Agent>('/api/v1/agents/register', {
    method: 'POST',
    tokenKind: 'user',
    body: JSON.stringify(payload),
  });
}

export async function registerExternalAgent(payload: RegisterExternalAgentPayload) {
  return requestJson<Agent>('/api/v1/agents/register-external', {
    method: 'POST',
    tokenKind: 'user',
    body: JSON.stringify(payload),
  });
}

export async function discoverAgents(params: DiscoverAgentsParams = {}) {
  const search = new URLSearchParams();
  if (params.query) search.set('query', params.query);
  const tags = encodeList(params.tags);
  const skills = encodeList(params.skills);
  const domains = encodeList(params.domains);
  if (tags) search.set('tags', tags);
  if (skills) search.set('skills', skills);
  if (domains) search.set('domains', domains);
  if (params.runtimeStatus) search.set('runtime_status', params.runtimeStatus);
  if (params.limit) search.set('limit', String(params.limit));
  if (params.offset) search.set('offset', String(params.offset));
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return requestJson<AgentListResult>(`/api/v1/agents/discover${suffix}`, {
    tokenKind: 'none',
  });
}

export async function getPublicAgent(id: string) {
  return requestJson<Agent>(`/api/v1/agents/${id}`, { tokenKind: 'none' });
}

export async function getAgentTags() {
  return requestJson<AgentTagCount[]>('/api/v1/agents/tags', { tokenKind: 'none' });
}

export async function listOwnerAgents(userId: string) {
  return requestJson<Agent[]>(`/api/v1/owner/agents/user/${userId}`, {
    tokenKind: 'user',
  });
}

export async function listAdminAgents() {
  return requestJson<Agent[]>('/api/v1/admin/agents', { tokenKind: 'admin' });
}

export async function listPendingAgents() {
  return requestJson<Agent[]>('/api/v1/admin/agents/pending', { tokenKind: 'admin' });
}

export async function approveAgent(id: string, comment?: string) {
  return requestJson<Agent>(`/api/v1/admin/agents/${id}/approve`, {
    method: 'POST',
    tokenKind: 'admin',
    body: JSON.stringify({ comment }),
  });
}

export async function rejectAgent(id: string, comment: string) {
  return requestJson<Agent>(`/api/v1/admin/agents/${id}/reject`, {
    method: 'POST',
    tokenKind: 'admin',
    body: JSON.stringify({ comment }),
  });
}

export async function forceDisableAgent(id: string) {
  return requestJson<Agent>(`/api/v1/admin/agents/${id}/force-disable`, {
    method: 'POST',
    tokenKind: 'admin',
  });
}
