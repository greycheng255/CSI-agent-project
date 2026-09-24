import { Injectable, Logger, BadRequestException } from '@nestjs/common';

/**
 * Casdoor SSO（OIDC 授权码流程）协议层。
 * 对接规范见 docs/Console-SSO-Integration-Guide-v2-Casdoor.md（v2.0，全部端点已实测）：
 * - authorize：{endpoint}/login/oauth/authorize（response_type=code，scope=openid profile email）
 * - token：{endpoint}/api/login/oauth/access_token（form-urlencoded，机密客户端）
 * - 验签：RS256，公钥从 /.well-known/jwks 获取（无需共享密钥）
 * - 平台用户映射：properties.genesis_user_id（sub 是 Casdoor 用户 id，≠平台 user_id）
 * 复用 CasdoorSyncService 的同一组 CASDOOR_* 环境变量。
 */

export interface CasdoorTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type: string;
  scope?: string;
  id_token?: string;
}

export interface CasdoorTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  name?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  properties?: {
    org_id?: string;
    genesis_user_id?: string;
    genesis_phone?: string;
  };
}

interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
  [key: string]: unknown;
}

const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1h

@Injectable()
export class CasdoorSsoService {
  private readonly logger = new Logger(CasdoorSsoService.name);
  private jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

  private get endpoint(): string {
    return process.env.CASDOOR_ENDPOINT?.trim().replace(/\/$/, '') ?? '';
  }
  private get clientId(): string {
    return process.env.CASDOOR_CLIENT_ID?.trim() ?? '';
  }
  private get clientSecret(): string {
    return process.env.CASDOOR_CLIENT_SECRET?.trim() ?? '';
  }

  isConfigured(): boolean {
    return !!(this.endpoint && this.clientId && this.clientSecret);
  }

  /**
   * 回调地址白名单（精确匹配）。CASDOOR_SSO_REDIRECT_URIS 逗号分隔；
   * 未配置时默认 Casdoor 应用 genesis-console 已备案的两个回调。
   */
  private get redirectUriWhitelist(): string[] {
    const raw = process.env.CASDOOR_SSO_REDIRECT_URIS?.trim();
    const list = raw
      ? raw.split(',').map((s) => s.trim()).filter(Boolean)
      : [
          'https://www.csi.shopping/callback',
          'http://www.csi.shopping/callback',
        ];
    return list;
  }

  /** 校验并透传回调地址；不在白名单 → 400（防开放重定向） */
  resolveRedirectUri(requested: string): string {
    const uri = requested?.trim() ?? '';
    if (!uri || !this.redirectUriWhitelist.includes(uri)) {
      throw new BadRequestException(
        `redirect_uri 不在白名单: ${uri || '(空)'}；如需新增环境回调请联系平台配置 CASDOOR_SSO_REDIRECT_URIS`,
      );
    }
    return uri;
  }

  /** 生成 authorize 跳转 URL（state 由前端生成并在回调时比对，防 CSRF） */
  buildAuthorizeUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state,
    });
    return `${this.endpoint}/login/oauth/authorize?${params.toString()}`;
  }

  /** 授权码换 token（form-urlencoded；错用 JSON 会得到 unsupported_grant_type） */
  async exchangeCode(code: string, redirectUri: string): Promise<CasdoorTokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: redirectUri,
    });
    let res: Response;
    try {
      res = await fetch(`${this.endpoint}/api/login/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err) {
      throw new BadRequestException(
        `Casdoor 不可达: ${String((err as Error).message)}`,
      );
    }
    const json = (await res.json().catch(() => null)) as
      | (CasdoorTokenResponse & { error?: string; error_description?: string })
      | null;
    if (!res.ok || !json?.access_token) {
      throw new BadRequestException(
        `授权码无效或已使用: ${json?.error_description ?? json?.error ?? `HTTP ${res.status}`}`,
      );
    }
    return json;
  }

  /** 拉取 JWKS（带 1h 缓存；kid 未命中时强制刷新一次） */
  private async getJwks(force = false): Promise<Jwk[]> {
    if (!force && this.jwksCache && Date.now() - this.jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
      return this.jwksCache.keys;
    }
    const res = await fetch(`${this.endpoint}/.well-known/jwks`);
    if (!res.ok) {
      throw new BadRequestException(`JWKS 拉取失败: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { keys?: Jwk[] };
    if (!json.keys?.length) {
      throw new BadRequestException('JWKS 响应无公钥');
    }
    this.jwksCache = { keys: json.keys, fetchedAt: Date.now() };
    return json.keys;
  }

  /**
   * RS256 验签 + iss/aud/exp 校验。
   * 优先验 id_token；Casdoor 的 access_token 本身也是同 claims 的 RS256 JWT，作为兜底。
   */
  async verifyToken(token: string): Promise<CasdoorTokenClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new BadRequestException('token 格式非法');
    }
    const [h64, p64, s64] = parts;
    let header: { alg?: string; kid?: string };
    try {
      header = JSON.parse(Buffer.from(h64, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('token header 解析失败');
    }
    if (header.alg !== 'RS256') {
      throw new BadRequestException(`仅支持 RS256，收到 ${header.alg}`);
    }

    let keys = await this.getJwks();
    let jwk = keys.find((k) => header.kid && k.kid === header.kid) ??
      (keys.length === 1 ? keys[0] : undefined);
    if (!jwk && header.kid) {
      // kid 未命中：缓存可能过期，强制刷新一次再试
      keys = await this.getJwks(true);
      jwk = keys.find((k) => k.kid === header.kid);
    }
    if (!jwk) {
      throw new BadRequestException('JWKS 中无匹配公钥');
    }

    const { createPublicKey, verify } = await import('crypto');
    const publicKey = createPublicKey({ key: jwk as unknown as Record<string, string>, format: 'jwk' });
    const signed = Buffer.from(`${h64}.${p64}`);
    const signature = Buffer.from(s64, 'base64url');
    if (!verify('RSA-SHA256', signed, publicKey, signature)) {
      throw new BadRequestException('token 签名验证失败');
    }

    let claims: CasdoorTokenClaims;
    try {
      claims = JSON.parse(Buffer.from(p64, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('token payload 解析失败');
    }

    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== this.endpoint) {
      throw new BadRequestException(`iss 不匹配: ${claims.iss}`);
    }
    if (claims.exp <= now) {
      throw new BadRequestException('token 已过期');
    }
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(this.clientId)) {
      throw new BadRequestException('aud 不匹配');
    }
    return claims;
  }

  /**
   * 授权码登录全流程：换 token → 验签 → 取平台用户映射键。
   * 返回 claims 与平台用户关联键（genesis_user_id 优先，name(手机号) 兜底）。
   */
  async resolvePlatformIdentity(
    code: string,
    redirectUri: string,
  ): Promise<{ claims: CasdoorTokenClaims; platformUserId: string | null; phone: string | null }> {
    const tokens = await this.exchangeCode(code, redirectUri);
    const tokenToVerify = tokens.id_token ?? tokens.access_token;
    const claims = await this.verifyToken(tokenToVerify);
    const platformUserId = claims.properties?.genesis_user_id?.trim() || null;
    const phone = claims.name?.trim() || claims.properties?.genesis_phone?.trim() || null;
    if (!platformUserId && !phone) {
      this.logger.error(
        `casdoor token 缺平台映射键: sub=${claims.sub}（用户可能未经平台注册同步）`,
      );
    }
    return { claims, platformUserId, phone };
  }
}
