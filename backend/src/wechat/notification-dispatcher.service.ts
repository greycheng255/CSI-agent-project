import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { NotificationOutbox, NotificationOutboxStatus } from './notification-outbox.entity';
import { User } from '../users/entities/user.entity';
import {
  MAX_WEBHOOK_ATTEMPTS,
  backoffDelayFor,
} from '../longtask/contract/backoff';

export interface NotificationSendFn {
  (
    openid: string,
    templateId: string,
    payload: Record<string, unknown>,
  ): Promise<{ done: boolean; delivered: boolean; retryable: boolean; error?: string }>;
}

export interface NotificationDispatchResult {
  sent: number;
  dead: number;
  retried: number;
}

export interface EnqueueInput {
  noKey: string;
  userId: string;
  eventType: string;
  templateId: string | null;
  data: Record<string, unknown>;
}

/**
 * 业务通知调度（微信渠道，照抄 webhook-dispatcher 的 at-least-once + 退避 + 死信模式）。
 * enqueue：反查 user.openid；无 openid → 记 skipped（不重试）。
 * processDue：cron 每 10s 轮询,消费 pending；成功→success，终态错误→dead，可恢复→退避重试。
 */
@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    @InjectRepository(NotificationOutbox)
    private readonly outboxRepo: Repository<NotificationOutbox>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async enqueue(input: EnqueueInput): Promise<void> {
    const user = await this.usersRepo.findOne({ where: { id: input.userId } });
    const openid = user?.wechatOpenid ?? null;

    if (!openid) {
      // 未绑定微信：落一条 skipped 审计，不重试
      await this.saveRow(input, 'skipped', null, null, 'no-wechat-openid');
      this.logger.log(
        `notification skip: event=${input.eventType} user=${input.userId} reason=no-wechat-openid`,
      );
      return;
    }

    const exists = await this.outboxRepo.findOne({ where: { noKey: input.noKey } });
    if (exists) return; // 幂等

    await this.saveRow(
      input,
      'pending',
      openid,
      null,
      null,
      input.templateId,
    );
  }

  private async saveRow(
    input: EnqueueInput,
    status: NotificationOutboxStatus,
    openid: string | null,
    nextAttemptAt: Date | null,
    lastError: string | null,
    templateId?: string | null,
  ): Promise<void> {
    const payload = { ...input.data, openid };
    await this.outboxRepo.save(
      this.outboxRepo.create({
        noKey: input.noKey,
        userId: input.userId,
        eventType: input.eventType,
        channel: 'wechat',
        payload,
        templateId: templateId ?? input.templateId,
        status,
        attempts: 0,
        nextAttemptAt,
        lastError,
      }),
    );
  }

  /** 处理到期通知（cron 调用；测试注入 now 与 sendFn） */
  async processDue(
    now: Date,
    sendFn: NotificationSendFn,
  ): Promise<NotificationDispatchResult> {
    const due = await this.outboxRepo.find({
      where: { status: 'pending', nextAttemptAt: LessThanOrEqual(now) },
    });

    const result: NotificationDispatchResult = { sent: 0, dead: 0, retried: 0 };
    for (const item of due) {
      if (item.attempts >= MAX_WEBHOOK_ATTEMPTS) {
        await this.deadLetter(item, 'attempts-exhausted-before-send');
        result.dead += 1;
        continue;
      }

      const openid = (item.payload?.openid as string | undefined) ?? '';
      const templateId = item.templateId ?? '';

      let outcome: { done: boolean; delivered: boolean; retryable: boolean; error?: string };
      try {
        outcome = await sendFn(openid, templateId, item.payload ?? {});
      } catch (e) {
        outcome = {
          done: false,
          delivered: false,
          retryable: true,
          error: `throw:${String((e as Error).message)}`,
        };
      }

      if (outcome.done && outcome.delivered) {
        item.status = 'success';
        item.lastError = null;
        item.nextAttemptAt = null;
        result.sent += 1;
      } else if (!outcome.retryable) {
        await this.deadLetter(item, outcome.error ?? 'terminal-error');
        result.dead += 1;
      } else {
        item.attempts += 1;
        item.lastError = outcome.error ?? 'unknown';
        if (item.attempts >= MAX_WEBHOOK_ATTEMPTS) {
          await this.deadLetter(item, item.lastError);
          result.dead += 1;
        } else {
          item.nextAttemptAt = new Date(
            now.getTime() + backoffDelayFor(item.attempts),
          );
          result.retried += 1;
        }
      }
      await this.outboxRepo.save(item);
    }
    return result;
  }

  private async deadLetter(item: NotificationOutbox, reason: string): Promise<void> {
    item.status = 'dead';
    item.lastError = reason;
    item.nextAttemptAt = null;
    await this.outboxRepo.save(item);
    this.logger.error(
      `notification dead-lettered | event=${item.eventType} item=${item.noKey} user=${item.userId} reason=${reason}`,
    );
  }
}