export const normalizeBaseUrl = (value: string | undefined) => {
  const normalized = value?.trim().replace(/\/+$/, '');
  return normalized || '';
};

const readEnv = (name: string) => {
  const value = import.meta.env[name];
  return typeof value === 'string' ? value.trim() : '';
};

/** API 基址：VITE_API_BASE 设置时直连该后端（如 http://122.51.51.177:30080），否则空串走 vite 代理 */
export const API_BASE = normalizeBaseUrl(readEnv('VITE_API_BASE'));

export const AGENT_API_BASE =
  normalizeBaseUrl(import.meta.env.VITE_AGENT_API_BASE) || 'https://api.opennotebook.chat';

export const AGENT_REST_BASE = `${AGENT_API_BASE}/api/v1`;

export const OPENNOTEBOOK_OAUTH_CLIENT_ID = readEnv(
  'VITE_AGENT_OPENNOTEBOOK_OAUTH_CLIENT_ID',
);

export const OPENNOTEBOOK_OAUTH_REDIRECT_PATH = '/oauth/opennotebook/callback';

export const OPENNOTEBOOK_AGENT_PROVIDER = {
  id: 'opennotebook-agent',
  name: 'OpenNotebook Agent',
  restBase: AGENT_REST_BASE,
};
