import { Injectable, BadRequestException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { SsoClient } from './entities/sso-client.entity';
import { SsoAuthorizationCode } from './entities/sso-authorization-code.entity';
import { AuthService } from './auth.service';
import { User } from '../users/entities/user.entity';

const AUTH_CODE_TTL_MS = 10 * 60 * 1000;

export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
};

export type TokenExchangeRequest = {
  grantType: string;
  code: string;
  clientId: string;
  clientSecret?: string;
  codeVerifier?: string;
  redirectUri: string;
};

@Injectable()
export class SsoService implements OnModuleInit {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    @InjectRepository(SsoClient)
    private ssoClientsRepository: Repository<SsoClient>,
    @InjectRepository(SsoAuthorizationCode)
    private authCodesRepository: Repository<SsoAuthorizationCode>,
    private readonly authService: AuthService,
  ) {}

  /**
   * 启动时确保内置客户端存在（openclaw-cli：公开客户端，仅 PKCE，回环回调任意端口）
   */
  async onModuleInit() {
    await this.ensureClient(
      'openclaw-cli',
      'Openclaw CLI',
      ['http://127.0.0.1/callback', 'http://localhost/callback'],
      false,
    );
  }

  /**
   * 确保客户端存在；新建机密客户端时返回明文 secret（仅此一次）
   */
  async ensureClient(
    clientId: string,
    name: string,
    redirectUris: string[],
    confidential: boolean,
    clientSecret?: string,
  ): Promise<{ client: SsoClient; secret?: string }> {
    let client = await this.ssoClientsRepository.findOne({
      where: { clientId },
    });

    if (!client) {
      const secret =
        confidential ? clientSecret || this.generateSecret() : undefined;
      client = this.ssoClientsRepository.create({
        clientId,
        name,
        redirectUris: JSON.stringify(redirectUris),
        clientSecretHash: secret ? this.hashSecret(secret) : null,
      });
      await this.ssoClientsRepository.save(client);
      this.logger.log(`SSO client registered: ${clientId}`);
      return { client, secret };
    }
    return { client };
  }

  private hashSecret(secret: string) {
    return createHash('sha256').update(secret).digest('hex');
  }

  private generateSecret() {
    return randomBytes(32).toString('base64url');
  }

  private safeEqualHex(a: string, b: string) {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }

  /**
   * redirect_uri 校验：精确匹配白名单；
   * 回环地址（127.0.0.1/localhost/::1）允许任意端口（RFC 8252 本地回调）
   */
  isRedirectUriAllowed(client: SsoClient, redirectUri: string): boolean {
    const allowed = client.getRedirectUris();
    if (allowed.includes(redirectUri)) return true;

    try {
      const url = new URL(redirectUri);
      const isLoopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(
        url.hostname,
      );
      if (!isLoopback) return false;
      return allowed.some((entry) => {
        try {
          const allowedUrl = new URL(entry);
          return (
            allowedUrl.protocol === url.protocol &&
            ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(
              allowedUrl.hostname,
            ) &&
            allowedUrl.pathname === url.pathname
          );
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  }

  /** 接入方列表 */
  async listClients() {
    return this.ssoClientsRepository.find({ order: { createdAt: 'DESC' } });
  }

  /**
   * 校验授权请求参数，返回客户端记录
   */
  async validateAuthorizeRequest(req: AuthorizeRequest): Promise<SsoClient> {
    if (!req.clientId || !req.redirectUri) {
      throw new BadRequestException('缺少 client_id 或 redirect_uri');
    }
    if (req.codeChallengeMethod && req.codeChallengeMethod !== 'S256') {
      throw new BadRequestException('仅支持 S256 code_challenge_method');
    }
    const client = await this.ssoClientsRepository.findOne({
      where: { clientId: req.clientId },
    });
    if (!client) {
      throw new BadRequestException('未注册的 client_id');
    }
    if (!this.isRedirectUriAllowed(client, req.redirectUri)) {
      throw new BadRequestException('redirect_uri 未在白名单中');
    }
    return client;
  }

  /**
   * 为已登录用户签发一次性授权码
   */
  async issueAuthorizationCode(user: User, req: AuthorizeRequest) {
    const client = await this.validateAuthorizeRequest(req);
    const code = randomBytes(32).toString('base64url');

    await this.authCodesRepository.save(
      this.authCodesRepository.create({
        codeHash: this.hashSecret(code),
        user,
        clientId: client.clientId,
        redirectUri: req.redirectUri,
        codeChallenge: req.codeChallenge || null,
        expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
        usedAt: null,
      }),
    );

    return { code, clientId: client.clientId, redirectUri: req.redirectUri };
  }

  /**
   * 授权码换 access_token
   */
  async exchangeCode(req: TokenExchangeRequest) {
    if (req.grantType !== 'authorization_code') {
      throw new BadRequestException('仅支持 authorization_code');
    }

    const client = await this.ssoClientsRepository.findOne({
      where: { clientId: req.clientId },
    });
    if (!client) {
      throw new BadRequestException('未注册的 client_id');
    }

    // 机密客户端必须校验 secret；公开客户端（无 secret）必须走 PKCE
    if (client.clientSecretHash) {
      if (!req.clientSecret || !this.safeEqualHex(this.hashSecret(req.clientSecret), client.clientSecretHash)) {
        throw new BadRequestException('client_secret 校验失败');
      }
    }

    const codeHash = this.hashSecret(req.code);
    const codeRow = await this.authCodesRepository.findOne({
      where: { codeHash },
      relations: ['user'],
    });
    if (!codeRow) {
      throw new BadRequestException('无效的授权码');
    }
    if (codeRow.usedAt) {
      // 授权码重放：直接作废该用户由此码签发的后续风险，这里简单拒绝
      throw new BadRequestException('授权码已被使用');
    }
    if (codeRow.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('授权码已过期');
    }
    if (codeRow.clientId !== client.clientId) {
      throw new BadRequestException('授权码与 client_id 不匹配');
    }
    if (!req.redirectUri || codeRow.redirectUri !== req.redirectUri) {
      throw new BadRequestException('redirect_uri 与授权时不一致');
    }

    // PKCE 校验
    if (codeRow.codeChallenge) {
      if (!req.codeVerifier) {
        throw new BadRequestException('缺少 code_verifier');
      }
      const verifierHash = createHash('sha256')
        .update(req.codeVerifier)
        .digest('base64url');
      if (verifierHash !== codeRow.codeChallenge) {
        throw new BadRequestException('PKCE 校验失败');
      }
    } else if (!client.clientSecretHash) {
      // 公开客户端且授权时未带 code_challenge，拒绝
      throw new BadRequestException('公开客户端必须使用 PKCE');
    }

    codeRow.usedAt = new Date();
    await this.authCodesRepository.save(codeRow);

    const accessToken = await this.authService.issueUserToken(codeRow.user, {
      clientId: client.clientId,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: null,
      user: {
        id: codeRow.user.id,
        phone: codeRow.user.phone,
        displayName: codeRow.user.displayName,
        kycStatus: codeRow.user.kycStatus,
      },
    };
  }
}
