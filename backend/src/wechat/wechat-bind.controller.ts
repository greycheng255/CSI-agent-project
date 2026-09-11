import { Controller, Get, Logger, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { WechatTokenService } from './wechat-token.service';
import { NotificationDeliveryService } from './notification-delivery.service';

/**
 * 微信绑定入口（公众号网页授权 snsapi_base 静默绑定 openid）。
 * - GET /bind-url   返回可跳转的授权 URL（前端引导用户跳转）
 * - GET /callback   授权回调（?code=），换 openid 写回当前用户
 * - GET /status     查询当前用户是否已绑定
 */
@Controller('api/v1/wechat')
@UseGuards(AuthGuard)
export class WechatBindController {
  private readonly logger = new Logger(WechatBindController.name);

  constructor(
    private readonly tokenService: WechatTokenService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  @Get('bind-url')
  bindUrl() {
    if (!this.tokenService.isConfigured()) {
      return { configured: false, url: null };
    }
    const redirectUri =
      process.env.WECHAT_BIND_REDIRECT_URI?.trim() ?? '';
    const state = Math.random().toString(36).slice(2, 10);
    const url = this.tokenService.buildBindUrl(redirectUri, state);
    return { configured: true, url, state };
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Req() req: RequestWithUser,
  ) {
    if (!code) {
      return { ok: false, error: 'missing-code' };
    }
    const userId = req.user?.id;
    if (!userId) {
      return { ok: false, error: 'no-user' };
    }
    try {
      const openid = await this.tokenService.getOpenIdByCode(code);
      await this.delivery.bindOpenid(userId, openid);
      return { ok: true, bound: true };
    } catch (err) {
      this.logger.error(`wechat bind fail user=${userId}: ${String(err)}`);
      return { ok: false, error: (err as Error).message };
    }
  }

  @Get('status')
  async status(@Req() req: RequestWithUser) {
    const userId = req.user?.id;
    if (!userId) {
      return { configured: this.tokenService.isConfigured(), bound: false };
    }
    const bound = await this.delivery.hasOpenid(userId);
    return {
      configured: this.tokenService.isConfigured(),
      bound,
    };
  }
}