export const API_BASE = '';

export const normalizeBaseUrl = (value: string | undefined) => {
  const normalized = value?.trim().replace(/\/+$/, '');
  return normalized || '';
};

const readEnv = (name: string) => {
  const value = import.meta.env[name];
  return typeof value === 'string' ? value.trim() : '';
};

const normalizeAuthorization = (authorization: string, accessToken: string) => {
  const value = authorization.trim();
  if (value.toLowerCase().startsWith('authorization:')) {
    return value.slice(value.indexOf(':') + 1).trim();
  }
  if (value) return value;
  return accessToken ? `Bearer ${accessToken}` : '';
};

export const AGENT_API_BASE =
  normalizeBaseUrl(import.meta.env.VITE_AGENT_API_BASE) || 'https://api.opennotebook.chat';

export const AGENT_REST_BASE =
  normalizeBaseUrl(readEnv('VITE_AGENT_REST_BASE')) || `${AGENT_API_BASE}/api/v1/agent`;

export const OPENNOTEBOOK_AGENT_PROVIDER = {
  id: 'opennotebook-agent',
  name: 'OpenNotebook Agent',
  restBase:
    normalizeBaseUrl(readEnv('VITE_AGENT_OPENNOTEBOOK_REST_BASE')) ||
    'https://www.opennotebook.chat/api/v1/agent',
  mcpEndpoint:
    normalizeBaseUrl(readEnv('VITE_AGENT_OPENNOTEBOOK_MCP_ENDPOINT')) ||
    'https://www.opennotebook.chat/api/v1/agent/mcp',
  defaultWorkspaceId:
    readEnv('VITE_AGENT_OPENNOTEBOOK_WORKSPACE_ID') ||
    readEnv('VITE_DEFAULT_WORKSPACE_ID') ||
    '64f444f0-0814-45e9-97fe-5570f78c0cac',
  defaultTenantId:
    readEnv('VITE_AGENT_OPENNOTEBOOK_TENANT_ID') ||
    readEnv('VITE_DEFAULT_TENANT_ID') ||
    '29803cbb-10b0-49c1-ac49-1eb296cf9f36',
  defaultUserId:
    readEnv('VITE_AGENT_OPENNOTEBOOK_USER_ID') ||
    'be31dd44-7c26-4316-b514-40586044e015',
  authorization: normalizeAuthorization(
    readEnv('VITE_AGENT_OPENNOTEBOOK_AUTHORIZATION'),
    readEnv('VITE_AGENT_OPENNOTEBOOK_ACCESS_TOKEN'),
  ),
};
