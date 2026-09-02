import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { signPayload } from './hmac-sign';
import { uuidv7 } from './uuid7';
import {
  SendWebhookFn,
  WebhookDispatcherService,
} from './webhook-dispatcher.service';

const DISPATCH_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * 出站 Webhook 生产投递驱动（对接指南 §3.4）：
 * - 每 10s 处理 outbox 到期项（WebhookDispatcherService.processDue）
 * - 真实 sendFn：POST + Bearer LONGTASK_SERVICE_TOKEN + X-Signature
 *   （HMAC-SHA256(body 原文 + ts)，与入站 HmacGuard 同一口径）
 * - 未配置 LONGTASK_SERVICE_TOKEN（本地开发/单测环境）时不投递，避免空转报错
 */
@Injectable()
export class WebhookDispatcherCron {
  private readonly logger = new Logger(WebhookDispatcherCron.name);

  constructor(private readonly dispatcher: WebhookDispatcherService) {}

  readonly sendFn: SendWebhookFn = async (targetUrl, payload, meta) => {
    // M→C 出站方向密钥（Console 清单 C2：按方向分离；未设时回落统一 token）
    const token =
      process.env.LONGTASK_OUTBOUND_TOKEN ?? process.env.LONGTASK_SERVICE_TOKEN ?? '';
    const body = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Signature': `t=${ts},v1=${signPayload(body, ts, token)}`,
          'X-Request-Id': uuidv7(),
          'Idempotency-Key': meta.eventId,
        },
        body,
        signal: controller.signal,
      });
      return { status: res.status };
    } finally {
      clearTimeout(timer);
    }
  };

  @Interval(DISPATCH_INTERVAL_MS)
  async dispatchDue(): Promise<void> {
    if (!(process.env.LONGTASK_OUTBOUND_TOKEN ?? process.env.LONGTASK_SERVICE_TOKEN)) return;
    try {
      const result = await this.dispatcher.processDue(new Date(), this.sendFn);
      if (result.sent > 0 || result.dead > 0) {
        this.logger.log(
          `webhook dispatch: sent=${result.sent} retried=${result.retried} dead=${result.dead}`,
        );
      }
    } catch (err) {
      this.logger.error(`webhook dispatch tick failed: ${String(err)}`);
    }
  }
}
