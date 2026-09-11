import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  NotificationDispatcherService,
  NotificationSendFn,
} from './notification-dispatcher.service';
import { WechatTemplateService } from './wechat-template.service';

const NOTIFY_INTERVAL_MS = 10_000;

/**
 * 业务通知生产投递驱动：
 * - 每 10s 处理 notification_outbox 到期项
 * - 真实 sendFn：调微信模板消息
 * - 未配置 WECHAT_APPID / WECHAT_NOTIFY_ENABLED=false 时短路，避免空转报错
 */
@Injectable()
export class NotificationDispatcherCron {
  private readonly logger = new Logger(NotificationDispatcherCron.name);

  constructor(
    private readonly dispatcher: NotificationDispatcherService,
    private readonly templateService: WechatTemplateService,
  ) {}

  private enabled(): boolean {
    if (process.env.WECHAT_NOTIFY_ENABLED?.trim() === 'false') return false;
    // mock 模式无需真实 appid/secret，仍驱动 outbox 验证全流程
    if (process.env.WECHAT_MOCK_MODE?.trim() === 'true') return true;
    if (!process.env.WECHAT_APPID || !process.env.WECHAT_APPSECRET) return false;
    return true;
  }

  readonly sendFn: NotificationSendFn = async (openid, templateId, payload) => {
    const data = Object.fromEntries(
      Object.entries(payload ?? {}).filter(
        ([k]) => k !== 'openid' && k !== 'eventType',
      ),
    );
    return this.templateService.send(
      openid,
      templateId,
      data as Record<string, string>,
    );
  };

  @Interval(NOTIFY_INTERVAL_MS)
  async dispatchDue(): Promise<void> {
    if (!this.enabled()) return;
    try {
      const result = await this.dispatcher.processDue(new Date(), this.sendFn);
      if (result.sent > 0 || result.dead > 0) {
        this.logger.log(
          `notification dispatch: sent=${result.sent} retried=${result.retried} dead=${result.dead}`,
        );
      }
    } catch (err) {
      this.logger.error(`notification dispatch tick failed: ${String(err)}`);
    }
  }
}