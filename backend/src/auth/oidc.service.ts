import { Injectable, Logger } from '@nestjs/common';
import { createHmac, createHash, timingSafeEqual, randomBytes } from 'crypto';
import { OrgService } from '../orgs/org.service';

/** id_token 有效期（秒）。短时令牌，Console 校验后建立本地登录态。 */
const ID_TOKEN_TTL_SECONDS = 60 * 60; // 1h

/** OIDC id_token 携带的用户摘要（由 SsoService.exchangeCode 结果提供） */
export type IdTokenUser = {
  id: string;
  phone?: string | null;
  email?: string | null;
  displayName?: string | null;
};

/**
 * 平台 IDP 的 OIDC 能力层（AuthPort 的 CSIAdapter 后端：IDP SSO / OIDC）。
 *
 * - HS256 签发 id_token（签名密钥来自 SSO_OIDC_SIGNING_SECRET；缺省时从
 *   LONGTASK_INBOUND_TOKEN/SERVICE_TOKEN 派生，零配置开发可用）。
 * - id_token 携带 org_id claim（统一账户体系 §6：账号→org 解析以登录态
 *   claim 首选，由 OrgService 兜底解析）。
 * - 暴露 OIDC discovery 文档，供 Console 的 AuthPort CSIAdapter 自动发现。
 *
 * 说明：HS256 为对称签名，平台与 Console 同属 CSI 内部信任域，Console 侧
 * 配置同一 SSO_OIDC_SIGNING_SECRET 即可验签（不暴露 jwks_uri）。
 */
@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);

  constructor(private readonly orgService: OrgService) {}

  /** OIDC issuer（discovery 与 id_token.iss 的唯一真相源） */
  getIssuer(): string {
    const explicit = process.env.SSO_OIDC_ISSUER?.trim();
    if (explicit) return explicit.replace(/\/$/, '');
    // 兜底：开发环境 API 基址
    const port = process.env.PORT || '4000';
    return `http://localhost:${port}`;
  }

  /** HS256 签名密钥（字节） */
  private signingKey(): Buffer {
    const raw =
      process.env.SSO_OIDC_SIGNING_SECRET?.trim() ||
      process.env.LONGTASK_INBOUND_TOKEN?.trim() ||
      process.env.LONGTASK_SERVICE_TOKEN?.trim() ||
      'csi-oidc-dev-signing-secret';
    return createHash('sha256').update(raw).digest();
  }

  /** 解析空格分隔的 scope（去重、小写） */
  parseScopes(scope?: string | null): string[] {
    if (!scope) return [];
    const set = new Set(
      scope
        .split(/\s+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
    return [...set];
  }

  /**
   * 签发 id_token（仅当 scopes 含 openid 时调用）。
   * @param nonce 授权阶段透传的 nonce，原样回填
   */
  async issueIdToken(
    user: IdTokenUser,
    clientId: string,
    nonce: string | null,
    scopes: string[],
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const org = await this.orgService.resolveByUserId(user.id);
    if (!org) {
      this.logger.warn(
        `id_token 签发时未解析到 org（user=${user.id}）；org_id claim 省略`,
      );
    }

    const payload: Record<string, unknown> = {
      iss: this.getIssuer(),
      sub: user.id,
      aud: clientId,
      exp: now + ID_TOKEN_TTL_SECONDS,
      iat: now,
    };
    if (nonce) payload.nonce = nonce;
    // OIDC scope→claim：profile→name，email→email；phone/org_id 为平台自定义 claim
    if (scopes.includes('profile')) {
      payload.name = user.displayName ?? null;
    }
    if (scopes.includes('email')) {
      payload.email = user.email ?? null;
    }
    // 平台自定义 claim（内部信任域，Console 直接消费）
    payload.phone = user.phone ?? null;
    if (org) {
      payload.org_id = org.id;
      payload.org_slug = org.slug;
    }

    return this.signJwt(payload);
  }

  /** HS256 JWT 签名（无第三方依赖，纯 Node crypto） */
  private signJwt(payload: Record<string, unknown>): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = this.base64url(JSON.stringify(header));
    const encodedPayload = this.base64url(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac('sha256', this.signingKey())
      .update(signingInput)
      .digest('base64url');
    return `${signingInput}.${signature}`;
  }

  /**
   * 校验 HS256 JWT 签名并返回 payload（供测试与平台内部自校验使用）。
   * Console 侧用自己的 JWT 库按同一 SSO_OIDC_SIGNING_SECRET 验签。
   */
  verifyJwt(token: string): Record<string, unknown> | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, signature] = parts;
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const expected = createHmac('sha256', this.signingKey())
      .update(signingInput)
      .digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (
      sigBuf.length !== expBuf.length ||
      !timingSafeEqual(sigBuf, expBuf)
    ) {
      return null;
    }
    try {
      return JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** OIDC discovery 文档 */
  getDiscovery() {
    const issuer = this.getIssuer();
    const base = `${issuer}/api/v1/sso`;
    return {
      issuer,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      userinfo_endpoint: `${base}/userinfo`,
      end_session_endpoint: `${base}/logout`,
      // HS256 对称签名：不暴露 jwks_uri（Console 配置共享密钥验签）
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      subject_types_supported: ['public'],
      scopes_supported: ['openid', 'profile', 'email'],
      id_token_signing_alg_values_supported: ['HS256'],
      token_endpoint_auth_methods_supported: [
        'client_secret_post',
        'none', // 公开客户端（PKCE）
      ],
      code_challenge_methods_supported: ['S256'],
      claims_supported: [
        'sub',
        'name',
        'email',
        'phone',
        'org_id',
        'org_slug',
        'nonce',
      ],
    };
  }

  private base64url(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64url');
  }

  /** 生成一次性 nonce（供平台自身作为客户端时使用，预留） */
  static generateNonce(): string {
    return randomBytes(16).toString('base64url');
  }
}
