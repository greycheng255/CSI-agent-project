import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, type RequestWithUser } from './auth.guard';
import { SuperAdminGuard } from '../admin/admin.guard';
import { SsoService } from './sso.service';
import { AuthService } from './auth.service';

interface AuthorizeQueryDto {
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

interface TokenRequestDto {
  grant_type?: string;
  code?: string;
  client_id?: string;
  client_secret?: string;
  code_verifier?: string;
  redirect_uri?: string;
}

interface CreateClientDto {
  clientId?: string;
  name?: string;
  redirectUris?: string[];
  confidential?: boolean;
}

/**
 * SSO 控制器（Marketplace 作为 IdP）
 * - GET  authorize：浏览器入口，校验后 302 到前端授权页
 * - POST authorize：已登录用户签发授权码（前端授权页调用）
 * - POST token：授权码换 access_token（子应用服务端调用）
 * - GET  userinfo：access_token 换用户信息
 */
@Controller('api/v1/sso')
export class SsoController {
  constructor(
    private readonly ssoService: SsoService,
    private readonly authService: AuthService,
  ) {}

  private toAuthorizeRequest(query: AuthorizeQueryDto) {
    return {
      clientId: query.client_id || '',
      redirectUri: query.redirect_uri || '',
      state: query.state,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
    };
  }

  /**
   * 浏览器授权入口：校验 client/redirect_uri 后跳转前端授权页
   * GET /api/v1/sso/authorize
   */
  @Get('authorize')
  async authorize(
    @Query() query: AuthorizeQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    try {
      await this.ssoService.validateAuthorizeRequest(
        this.toAuthorizeRequest(query),
      );
      const webUrl =
        process.env.SSO_WEB_URL ||
        process.env.WEB_BASE_URL ||
        process.env.PAYMENT_FRONTEND_BASE_URL ||
        'http://localhost:5173';
      const params = new URLSearchParams();
      params.set('client_id', query.client_id || '');
      params.set('redirect_uri', query.redirect_uri || '');
      if (query.state) params.set('state', query.state);
      if (query.code_challenge) params.set('code_challenge', query.code_challenge);
      if (query.code_challenge_method) {
        params.set('code_challenge_method', query.code_challenge_method);
      }
      res.redirect(
        302,
        `${webUrl.replace(/\/$/, '')}/sso/authorize?${params.toString()}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'invalid_request';
      res.status(400).json({ message: `SSO authorize 校验失败: ${message}` });
    }
  }

  /**
   * 已登录用户签发授权码（前端 /sso/authorize 页面调用）
   * POST /api/v1/sso/authorize
   */
  @Post('authorize')
  @UseGuards(AuthGuard)
  async issueCode(
    @Req() req: RequestWithUser,
    @Body() body: AuthorizeQueryDto,
  ) {
    const result = await this.ssoService.issueAuthorizationCode(req.user, {
      clientId: body.client_id || '',
      redirectUri: body.redirect_uri || '',
      state: body.state,
      codeChallenge: body.code_challenge,
      codeChallengeMethod: body.code_challenge_method,
    });
    return {
      code: result.code,
      state: body.state ?? null,
      redirect_uri: result.redirectUri,
    };
  }

  /**
   * 授权码换 access_token
   * POST /api/v1/sso/token
   */
  @Post('token')
  async token(@Body() body: TokenRequestDto) {
    return this.ssoService.exchangeCode({
      grantType: body.grant_type || 'authorization_code',
      code: body.code || '',
      clientId: body.client_id || '',
      clientSecret: body.client_secret,
      codeVerifier: body.code_verifier,
      redirectUri: body.redirect_uri || '',
    });
  }

  /**
   * 获取用户信息（Bearer access_token）
   * GET /api/v1/sso/userinfo
   */
  @Get('userinfo')
  @UseGuards(AuthGuard)
  userinfo(@Req() req: RequestWithUser) {
    const user = req.user;
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      displayName: user.displayName,
      kycStatus: user.kycStatus,
    };
  }

  /**
   * SSO 单点登出：
   * - 不带 client_id：撤销该用户全部登录/SSO 令牌（全端失效，PAT 保留）
   * - 带 client_id：仅撤销该接入方签发的令牌（单应用登出）
   * POST /api/v1/sso/logout
   */
  @Post('logout')
  @UseGuards(AuthGuard)
  async logout(
    @Req() req: RequestWithUser,
    @Body() body: { client_id?: string },
  ) {
    const revoked = await this.authService.revokeAllUserTokens(
      req.user.id,
      body?.client_id,
    );
    return { message: '已退出登录', revoked };
  }

  /**
   * 注册新的 SSO 接入方（仅超级管理员）
   * 机密客户端的 client_secret 仅在本次响应中返回一次
   * POST /api/v1/sso/clients
   */
  @Post('clients')
  @UseGuards(SuperAdminGuard)
  async createClient(@Body() body: CreateClientDto) {
    if (!body.clientId || !body.name || !Array.isArray(body.redirectUris)) {
      throw new BadRequestException('clientId、name、redirectUris 不能为空');
    }
    const { client, secret } = await this.ssoService.ensureClient(
      body.clientId,
      body.name,
      body.redirectUris,
      !!body.confidential,
    );
    return {
      message: '注册成功',
      client: {
        id: client.id,
        clientId: client.clientId,
        name: client.name,
        redirectUris: client.getRedirectUris(),
        confidential: !!client.clientSecretHash,
      },
      // 仅新建机密客户端时返回，请立即保存
      client_secret: secret ?? null,
    };
  }

  /**
   * 接入方列表（仅超级管理员）
   * GET /api/v1/sso/clients
   */
  @Get('clients')
  @UseGuards(SuperAdminGuard)
  async listClients() {
    const clients = await this.ssoService.listClients();
    return {
      clients: clients.map((client) => ({
        id: client.id,
        clientId: client.clientId,
        name: client.name,
        redirectUris: client.getRedirectUris(),
        confidential: !!client.clientSecretHash,
        createdAt: client.createdAt,
      })),
    };
  }
}
