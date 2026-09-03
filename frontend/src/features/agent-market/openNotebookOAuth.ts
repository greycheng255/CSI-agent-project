import {
  AGENT_API_BASE,
  OPENNOTEBOOK_OAUTH_CLIENT_ID,
  OPENNOTEBOOK_OAUTH_REDIRECT_PATH,
  normalizeBaseUrl,
} from '../../config/api';

const FLOW_STORAGE_PREFIX = 'genesis-opennotebook-oauth-flow';
const SESSION_STORAGE_PREFIX = 'genesis-opennotebook-oauth-session';
const LEGACY_API_KEY_PREFIX = 'genesis-opennotebook-api-key';
const FLOW_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

type OAuthMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
};

type OAuthFlow = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  returnTo: string;
  createdAt: number;
  issuer: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
};

type OAuthTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  refresh_expires_in?: unknown;
  scope?: unknown;
  grant_id?: unknown;
  user_id?: unknown;
  tenant_id?: unknown;
  error?: unknown;
  error_description?: unknown;
};

class OAuthTokenRequestError extends Error {
  readonly oauthCode: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OAuthTokenRequestError';
    this.oauthCode = code;
  }
}

export type OpenNotebookOAuthSession = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: number;
  refreshExpiresAt: number;
  scope: string;
  grantId: string;
  userId: string;
  tenantId: string;
  issuer: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  clientId: string;
};

const refreshRequests = new Map<string, Promise<OpenNotebookOAuthSession | null>>();

function flowStorageKey(accountId: string) {
  return `${FLOW_STORAGE_PREFIX}:${accountId}`;
}

function sessionStorageKey(accountId: string) {
  return `${SESSION_STORAGE_PREFIX}:${accountId}`;
}

function requireBrowser() {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('当前浏览器不支持 OAuth PKCE。');
  }
}

function requireClientId() {
  if (!OPENNOTEBOOK_OAUTH_CLIENT_ID) {
    throw new Error('尚未配置 VITE_AGENT_OPENNOTEBOOK_OAUTH_CLIENT_ID。');
  }
  return OPENNOTEBOOK_OAUTH_CLIENT_ID;
}

function isLoopback(hostname: string) {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname.toLowerCase());
}

function assertSafeEndpoint(value: string, name: string) {
  const url = new URL(value);
  if (url.username || url.password || url.hash) {
    throw new Error(`${name} 地址不安全。`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new Error(`${name} 必须使用 HTTPS（本地回环地址除外）。`);
  }
  return url.toString();
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomValue(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  window.crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function pkceChallenge(verifier: string) {
  const digest = await window.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

function constantTimeEqual(left: string, right: string) {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function safeReturnTo(value: string) {
  if (!value.startsWith('/') || value.startsWith('//')) return '/agent-market';
  if (value.startsWith(OPENNOTEBOOK_OAUTH_REDIRECT_PATH)) return '/agent-market';
  return value;
}

function parseStoredValue<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.sessionStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

async function discoverOAuthMetadata(): Promise<OAuthMetadata> {
  const expectedIssuer = normalizeBaseUrl(AGENT_API_BASE);
  assertSafeEndpoint(expectedIssuer, 'OpenNotebook Issuer');
  const response = await fetch(
    `${expectedIssuer}/.well-known/oauth-authorization-server`,
    { headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error' },
  );
  if (!response.ok) {
    throw new Error(`读取 OpenNotebook OAuth 配置失败 (${response.status})。`);
  }

  const metadata = await response.json() as Partial<OAuthMetadata>;
  if (normalizeBaseUrl(metadata.issuer) !== expectedIssuer) {
    throw new Error('OpenNotebook OAuth Issuer 与 VITE_AGENT_API_BASE 不一致。');
  }
  if (!metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.revocation_endpoint) {
    throw new Error('OpenNotebook OAuth Discovery 响应缺少必要端点。');
  }
  if (!metadata.code_challenge_methods_supported?.includes('S256')) {
    throw new Error('OpenNotebook OAuth 服务未声明支持 PKCE S256。');
  }
  if (!metadata.token_endpoint_auth_methods_supported?.includes('none')) {
    throw new Error('当前 OpenNotebook OAuth Client 不是 Public Client 模式。');
  }

  return {
    issuer: expectedIssuer,
    authorization_endpoint: assertSafeEndpoint(
      metadata.authorization_endpoint,
      'Authorization Endpoint',
    ),
    token_endpoint: assertSafeEndpoint(metadata.token_endpoint, 'Token Endpoint'),
    revocation_endpoint: assertSafeEndpoint(metadata.revocation_endpoint, 'Revocation Endpoint'),
    code_challenge_methods_supported: metadata.code_challenge_methods_supported,
    token_endpoint_auth_methods_supported: metadata.token_endpoint_auth_methods_supported,
  };
}

function sessionFromToken(
  payload: OAuthTokenResponse,
  metadata: Pick<OAuthMetadata, 'issuer' | 'token_endpoint' | 'revocation_endpoint'>,
  previous?: OpenNotebookOAuthSession,
): OpenNotebookOAuthSession {
  const accessToken = stringValue(payload.access_token);
  const refreshToken = stringValue(payload.refresh_token);
  const expiresIn = numberValue(payload.expires_in);
  const refreshExpiresIn = numberValue(payload.refresh_expires_in);
  if (!accessToken || !refreshToken || expiresIn <= 0 || refreshExpiresIn <= 0) {
    throw new Error('OpenNotebook OAuth Token 响应不完整。');
  }
  const now = Date.now();
  return {
    accessToken,
    refreshToken,
    tokenType: stringValue(payload.token_type) || 'Bearer',
    expiresAt: now + expiresIn * 1000,
    refreshExpiresAt: now + refreshExpiresIn * 1000,
    scope: stringValue(payload.scope) || previous?.scope || '*',
    grantId: stringValue(payload.grant_id) || previous?.grantId || '',
    userId: stringValue(payload.user_id) || previous?.userId || '',
    tenantId: stringValue(payload.tenant_id) || previous?.tenantId || '',
    issuer: metadata.issuer,
    tokenEndpoint: metadata.token_endpoint,
    revocationEndpoint: metadata.revocation_endpoint,
    clientId: requireClientId(),
  };
}

function saveSession(accountId: string, session: OpenNotebookOAuthSession) {
  window.sessionStorage.setItem(sessionStorageKey(accountId), JSON.stringify(session));
}

async function tokenRequest(endpoint: string, body: URLSearchParams) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    credentials: 'omit',
    redirect: 'error',
  });
  const payload = await response.json().catch(() => ({})) as OAuthTokenResponse;
  if (!response.ok) {
    const code = stringValue(payload.error);
    const message = stringValue(payload.error_description) ||
      code ||
      `OpenNotebook OAuth 请求失败 (${response.status})`;
    throw new OAuthTokenRequestError(code, message);
  }
  return payload;
}

export function clearLegacyOpenNotebookApiKey(accountId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(`${LEGACY_API_KEY_PREFIX}:${accountId}`);
}

export function readOpenNotebookOAuthSession(accountId: string) {
  const session = parseStoredValue<OpenNotebookOAuthSession>(sessionStorageKey(accountId));
  if (!session?.accessToken || !session.refreshToken || session.clientId !== OPENNOTEBOOK_OAUTH_CLIENT_ID) {
    return null;
  }
  return session;
}

export function clearOpenNotebookOAuthSession(accountId: string) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(sessionStorageKey(accountId));
  window.sessionStorage.removeItem(flowStorageKey(accountId));
}

export async function beginOpenNotebookAuthorization(accountId: string, returnTo: string) {
  requireBrowser();
  const clientId = requireClientId();
  const metadata = await discoverOAuthMetadata();
  const state = randomValue(32);
  const codeVerifier = randomValue(64);
  const codeChallenge = await pkceChallenge(codeVerifier);
  const redirectUri = `${window.location.origin}${OPENNOTEBOOK_OAUTH_REDIRECT_PATH}`;
  const flow: OAuthFlow = {
    state,
    codeVerifier,
    redirectUri,
    returnTo: safeReturnTo(returnTo),
    createdAt: Date.now(),
    issuer: metadata.issuer,
    tokenEndpoint: metadata.token_endpoint,
    revocationEndpoint: metadata.revocation_endpoint,
  };
  window.sessionStorage.setItem(flowStorageKey(accountId), JSON.stringify(flow));

  const authorizationUrl = new URL(metadata.authorization_endpoint);
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    scope: '*',
  }).toString();
  window.location.assign(authorizationUrl.toString());
}

export async function completeOpenNotebookAuthorization(
  accountId: string,
  search: string,
) {
  requireBrowser();
  const clientId = requireClientId();
  const flowKey = flowStorageKey(accountId);
  const flow = parseStoredValue<OAuthFlow>(flowKey);
  const params = new URLSearchParams(search);
  const returnedState = params.get('state') || '';
  if (!flow || Date.now() - flow.createdAt > FLOW_TTL_MS) {
    window.sessionStorage.removeItem(flowKey);
    throw new Error('OAuth 授权请求已过期，请重新连接。');
  }
  if (!returnedState || !constantTimeEqual(flow.state, returnedState)) {
    window.sessionStorage.removeItem(flowKey);
    throw new Error('OAuth state 校验失败，授权已拒绝。');
  }

  const expectedIssuer = normalizeBaseUrl(AGENT_API_BASE);
  const expectedRedirectUri = `${window.location.origin}${OPENNOTEBOOK_OAUTH_REDIRECT_PATH}`;
  if (
    normalizeBaseUrl(flow.issuer) !== expectedIssuer ||
    flow.redirectUri !== expectedRedirectUri
  ) {
    window.sessionStorage.removeItem(flowKey);
    throw new Error('OAuth 回调与发起授权时的地址不一致。');
  }
  assertSafeEndpoint(flow.tokenEndpoint, 'Token Endpoint');
  assertSafeEndpoint(flow.revocationEndpoint, 'Revocation Endpoint');

  const authorizationError = params.get('error');
  if (authorizationError) {
    window.sessionStorage.removeItem(flowKey);
    throw new Error(params.get('error_description') || '用户未允许 OpenNotebook 授权。');
  }
  const code = params.get('code');
  if (!code) {
    window.sessionStorage.removeItem(flowKey);
    throw new Error('OpenNotebook OAuth 回调缺少 authorization code。');
  }

  // Authorization Code 只能消费一次；交换失败时也必须重新发起授权。
  window.sessionStorage.removeItem(flowKey);
  const payload = await tokenRequest(flow.tokenEndpoint, new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: flow.redirectUri,
    code_verifier: flow.codeVerifier,
  }));
  const session = sessionFromToken(payload, {
    issuer: flow.issuer,
    token_endpoint: flow.tokenEndpoint,
    revocation_endpoint: flow.revocationEndpoint,
  });
  saveSession(accountId, session);
  clearLegacyOpenNotebookApiKey(accountId);
  return { session, returnTo: safeReturnTo(flow.returnTo) };
}

async function refreshSession(
  accountId: string,
  session: OpenNotebookOAuthSession,
) {
  if (session.refreshExpiresAt <= Date.now()) {
    clearOpenNotebookOAuthSession(accountId);
    return null;
  }
  try {
    const payload = await tokenRequest(session.tokenEndpoint, new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: session.clientId,
      refresh_token: session.refreshToken,
    }));
    const refreshed = sessionFromToken(payload, {
      issuer: session.issuer,
      token_endpoint: session.tokenEndpoint,
      revocation_endpoint: session.revocationEndpoint,
    }, session);
    saveSession(accountId, refreshed);
    return refreshed;
  } catch (error) {
    if (
      error instanceof OAuthTokenRequestError &&
      ['invalid_grant', 'invalid_client', 'unauthorized_client'].includes(error.oauthCode)
    ) {
      clearOpenNotebookOAuthSession(accountId);
      return null;
    }
    throw error;
  }
}

export async function getValidOpenNotebookOAuthSession(accountId: string) {
  requireBrowser();
  const session = readOpenNotebookOAuthSession(accountId);
  if (!session) return null;
  if (session.expiresAt - ACCESS_TOKEN_EXPIRY_BUFFER_MS > Date.now()) return session;

  const existing = refreshRequests.get(accountId);
  if (existing) return existing;
  const request = refreshSession(accountId, session).finally(() => {
    refreshRequests.delete(accountId);
  });
  refreshRequests.set(accountId, request);
  return request;
}

export async function getOpenNotebookOAuthAuthorization(accountId: string) {
  const session = await getValidOpenNotebookOAuthSession(accountId);
  return session ? `${session.tokenType || 'Bearer'} ${session.accessToken}` : '';
}

export async function disconnectOpenNotebookOAuth(accountId: string) {
  requireBrowser();
  const session = readOpenNotebookOAuthSession(accountId);
  if (!session) {
    clearOpenNotebookOAuthSession(accountId);
    return;
  }
  for (const [token, tokenType] of [
    [session.refreshToken, 'refresh_token'],
    [session.accessToken, 'access_token'],
  ] as const) {
    const response = await fetch(session.revocationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: session.clientId,
        token,
        token_type_hint: tokenType,
      }),
      credentials: 'omit',
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`撤销 OpenNotebook 授权失败 (${response.status})。`);
    }
  }
  clearOpenNotebookOAuthSession(accountId);
}
