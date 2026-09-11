import { Injectable, Logger } from '@nestjs/common';

const GET_TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
const OAUTH_TOKEN_URL = 'https://api.weixin.qq.com/sns/oauth2/access_token';
const WECHAT_AUTHORIZE_URL = 'https://open.weixin.qq.com/connect/oauth2/authorize';

interface TokenCacheEntry {
  value: string;
  expiresAt: number;
}

/**
 * 微信公众号 access_token 管理：
 * - 进程内缓存（expires_in=7200s，提前 120s 视为过期）
 * - 单例互斥防止并发刷新风暴
 * - 未配置 appid/appsecret 时 isConfigured()=false，调用方短路跳过
 * - 另提供 snsapi_base 网页授权：拼授权 URL + code 换 openid
 */
@Injectable()
export class WechatTokenService {
  private readonly logger = new Logger(WechatTokenService.name);
  private cache: TokenCacheEntry | null = null;
  private refreshing = false;
  private refreshQueue: Promise<string> | null = null;

  private get appid(): string {
    return process.env.WECHAT_APPID?.trim() ?? '';
  }
  private get secret(): string {
    return process.env.WECHAT_APPSECRET?.trim() ?? '';
  }

  isConfigured(): boolean {
    return !!(this.appid && this.secret);
  }

  getAppId(): string {
    return this.appid;
  }

  /** 强制清空缓存，下一次 getAccessToken 将刷新（token 失效时调用） */
  invalidate(): void {
    this.cache = null;
  }

  /** 公众号网页授权 URL（snsapi_base 静默） */
  buildBindUrl(redirectUri: string, state = '')
    : string {
    const params = new URLSearchParams({
      appid: this.appid,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'snsapi_base',
      ...(state ? { state } : {}),
    });
    return `${WECHAT_AUTHORIZE_URL}?${params.toString()}#wechat_redirect`;
  }

  /** snsapi_base 用 code 换取 openid（sns/oauth2/access_token，无需 appsecret 传 secret 即可） */
  async getOpenIdByCode(code: string): Promise<string> {
    if (!code) throw new Error('missing wechat oauth code');
    const url =
      `${OAUTH_TOKEN_URL}?appid=${encodeURIComponent(this.appid)}` +
      `&secret=${encodeURIComponent(this.secret)}&code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    const res = await fetch(url);
    const json = (await res.json()) as Record<string, unknown>;
    if (json.errcode) {
      throw new Error(
        `wechat oauth fail errcode=${json.errcode} errmsg=${json.errmsg}`,
      );
    }
    const openid = json.openid;
    if (typeof openid !== 'string' || !openid) {
      throw new Error('wechat oauth response missing openid');
    }
    return openid;
  }

  /** 获取有效 access_token（带缓存 + 单例刷新） */
  async getAccessToken(): Promise<string> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.value;
    }
    if (this.refreshQueue) return this.refreshQueue;
    this.refreshQueue = this.refresh().finally(() => {
      this.refreshQueue = null;
    });
    return this.refreshQueue;
  }

  private async refresh(): Promise<string> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.value;
    }
    if (this.refreshing) {
      // 理论上已被 refreshQueue 拦截，此处为兜底；直接读缓存（可能为 null 时报错由上层重试）
      if (this.cache && this.cache.expiresAt > now) return this.cache.value;
      throw new Error('wechat token refresh already in progress');
    }
    this.refreshing = true;
    try {
      const url =
        `${GET_TOKEN_URL}?grant_type=client_credential` +
        `&appid=${encodeURIComponent(this.appid)}&secret=${encodeURIComponent(this.secret)}`;
      const res = await fetch(url);
      const json = (await res.json()) as Record<string, unknown>;
      if (json.errcode) {
        throw new Error(
          `wechat token fail errcode=${json.errcode} errmsg=${json.errmsg}`,
        );
      }
      const token = json.access_token;
      const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 7200;
      if (typeof token !== 'string' || !token) {
        throw new Error('wechat token response missing access_token');
      }
      this.cache = {
        value: token,
        expiresAt: now + (expiresIn - 120) * 1000, // 提前 120s 过期
      };
      this.logger.log('wechat access_token refreshed');
      return token;
    } finally {
      this.refreshing = false;
    }
  }
}