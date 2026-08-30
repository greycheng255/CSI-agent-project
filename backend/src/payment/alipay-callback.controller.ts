import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { OnlinePaymentService } from './online-payment.service';

function stringParams(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) => {
      if (typeof value === 'string') return [[key, value]];
      if (typeof value === 'number' || typeof value === 'boolean') {
        return [[key, String(value)]];
      }
      return [];
    }),
  );
}

/** 支付渠道调用的公开端点；不可挂用户登录 Guard。 */
@Controller('api/v1/payments/alipay')
export class AlipayCallbackController {
  constructor(private readonly onlinePaymentService: OnlinePaymentService) {}

  @Post('notify')
  @HttpCode(200)
  @Header('content-type', 'text/plain; charset=utf-8')
  async notify(
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<'success' | 'failure'> {
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp =
      (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : '') ||
      req.ip;
    const success = await this.onlinePaymentService.handleAlipayNotification(
      stringParams(body),
      clientIp,
    );
    return success ? 'success' : 'failure';
  }

  @Get('return')
  async returnFromAlipay(
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    const target = await this.onlinePaymentService.resolveReturnTarget(
      stringParams(query),
    );
    response.redirect(302, target);
  }
}
