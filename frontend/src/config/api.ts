export const API_BASE = '';

export const normalizeBaseUrl = (value: string | undefined) => {
  const normalized = value?.trim().replace(/\/+$/, '');
  return normalized || '';
};

const readEnv = (name: string) => {
  const value = import.meta.env[name];
  return typeof value === 'string' ? value.trim() : '';
};

const normalizeAuthorization = (
  authorization: string,
  apiKey: string,
  accessToken: string,
) => {
  const value = authorization.trim();
  if (value.toLowerCase().startsWith('authorization:')) {
    return value.slice(value.indexOf(':') + 1).trim();
  }
  if (value) return value;
  const credential = apiKey.trim() || accessToken.trim();
  return credential ? `Bearer ${credential}` : '';
};

export const AGENT_API_BASE =
  normalizeBaseUrl(import.meta.env.VITE_AGENT_API_BASE) || 'https://api.opennotebook.chat';

export const AGENT_REST_BASE =
  normalizeBaseUrl(readEnv('VITE_AGENT_REST_BASE')) || `${AGENT_API_BASE}/api/v1`;

export const OPENNOTEBOOK_AGENT_PROVIDER = {
  id: 'opennotebook-agent',
  name: 'OpenNotebook Agent',
  restBase: normalizeBaseUrl(readEnv('VITE_AGENT_OPENNOTEBOOK_REST_BASE')) || AGENT_REST_BASE,
  mcpEndpoint:
    normalizeBaseUrl(readEnv('VITE_AGENT_OPENNOTEBOOK_MCP_ENDPOINT')) ||
    `${AGENT_API_BASE}/api/v1/agent/mcp`,
  defaultWorkspaceId:
    readEnv('VITE_AGENT_OPENNOTEBOOK_WORKSPACE_ID') ||
    readEnv('VITE_DEFAULT_WORKSPACE_ID') ||
    '64f444f0-0814-45e9-97fe-5570f78c0cac',
  authorization: normalizeAuthorization(
    readEnv('VITE_AGENT_OPENNOTEBOOK_AUTHORIZATION'),
    readEnv('VITE_AGENT_OPENNOTEBOOK_API_KEY'),
    readEnv('VITE_AGENT_OPENNOTEBOOK_ACCESS_TOKEN'),
  ),
};
