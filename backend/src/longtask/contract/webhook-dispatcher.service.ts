import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { WebhookOutbox } from './webhook-outbox.entity';
import { WebhookInboundEvent } from './webhook-inbound.entity';
import { backoffDelayFor, MAX_WEBHOOK_ATTEMPTS } from './backoff';

/**
 * Webhook 投递器（对接指南 §3.1/§4.1）：
 * - at-least-once：HTTP 2xx 成功；4xx 不重试直进死信；5xx/网络错误按退避重试
 * - 退避 5s/30s/2min/10min/1h 共 5 次；5 次失败进死信 + 告警
 * - 出站 event_id 固定（重投不变）；入站按 (event_id, event_type) 去重
 */
export interface SendWebhookResult {
  status: number;
}

export interface SendWebhookMeta {
  /** outbox event_id（uuid-v7），同时作 Idempotency-Key 头（§3.1） */
  eventId: string;
  /** 本次投递为第几次尝试（1 起） */
  attempt: number;
}

export type SendWebhookFn = (
  targetUrl: string,
  payload: Record<string, unknown>,
  meta: SendWebhookMeta,
) => Promise<SendWebhookResult>;

export interface ProcessDueResult {
  sent: number;
  dead: number;
  retried: number;
}

@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  constructor(
    @InjectRepository(WebhookOutbox)
    private readonly outboxRepo: Repository<WebhookOutbox>,
    @InjectRepository(WebhookInboundEvent)
    private readonly inboundRepo: Repository<WebhookInboundEvent>,
  ) {}

  /** 入站去重记录；返回 true=首次接收，false=重复事件（应直接 ACK 丢弃） */
  async recordInbound(
    eventId: string,
    eventType: string,
    payload?: Record<string, unknown>,
  ): Promise<boolean> {
    const exists = await this.inboundRepo.findOne({
      where: { eventId, eventType },
    });
    if (exists) return false;
    await this.inboundRepo.save(
      this.inboundRepo.create({ eventId, eventType, payload: payload ?? null }),
    );
    return true;
  }

  /**
   * 出站入队（event_id 缺省生成 uuid-v7 语义的 uuid；重投复用同一 id）。
   * §8.3 统一信封：接收方按 body 内 event_id 去重（§4.1），event_id 注入 payload
   * （与 outbox event_id、Idempotency-Key 头三者一致）。
   * 调用方传扁平业务体时自动组装信封外层（event_version/occurred_at/sent_at/source/data）；
   * 调用方已自带 data 容器的完整信封（如 opportunity.pushed §9.1）则原样透传，仅补齐 event_id。
   */
  enqueue(
    eventType: string,
    targetUrl: string,
    payload: Record<string, unknown>,
    eventId?: string,
  ): Promise<WebhookOutbox> {
    const id = eventId ?? (payload.event_id as string | undefined) ?? randomUUID();
    const body =
      payload.data && typeof payload.data === 'object'
        ? { ...payload, event_id: payload.event_id ?? id }
        : {
            event_id: id,
            event_type: eventType,
            event_version: 1,
            occurred_at: new Date().toISOString(),
            sent_at: new Date().toISOString(),
            source: 'marketplace',
            data: payload,
          };
    const row = this.outboxRepo.create({
      eventId: body.event_id as string,
      eventType,
      targetUrl,
      payload: body,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(),
    });
    return this.outboxRepo.save(row);
  }

  /**
   * 死信落库 + 告警（对接指南 §3.1「5 次失败进死信表 + 告警」）：
   * 始终写 logger.error；配置 WEBHOOK_DEAD_ALERT_URL 时 best-effort 推送告警（不阻塞、不影响投递结果）。
   */
  private async deadLetter(
    item: WebhookOutbox,
    reason: string,
  ): Promise<void> {
    item.status = 'dead';
    item.lastError = reason;
    item.nextAttemptAt = null;
    await this.outboxRepo.save(item);
    this.logger.error(
      `Webhook dead-lettered | event=${item.eventType} event_id=${item.eventId} target=${item.targetUrl} reason=${reason}`,
    );
    const alertUrl = process.env.WEBHOOK_DEAD_ALERT_URL?.trim();
    if (alertUrl) {
      try {
        await fetch(alertUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'webhook_dead_letter',
            event_type: item.eventType,
            event_id: item.eventId,
            target_url: item.targetUrl,
            reason,
          }),
        });
      } catch {
        /* 告警通道 best-effort：失败不影响死信落库 */
      }
    }
  }

  /** 处理到期投递（cron 每 10s 调用；测试注入 now 与 sendFn） */
  async processDue(
    now: Date,
    sendFn: SendWebhookFn,
  ): Promise<ProcessDueResult> {
    const due = await this.outboxRepo.find({
      where: { status: 'pending', nextAttemptAt: LessThanOrEqual(now) },
    });

    const result: ProcessDueResult = { sent: 0, dead: 0, retried: 0 };
    for (const item of due) {
      // 防御：attempts 已达上限的残留在本批直接进死信
      if (item.attempts >= MAX_WEBHOOK_ATTEMPTS) {
        await this.deadLetter(item, 'attempts-exhausted-before-send');
        result.dead += 1;
        continue;
      }

      let status: number;
      try {
        const res = await sendFn(item.targetUrl, item.payload, {
          eventId: item.eventId,
          attempt: item.attempts + 1,
        });
        status = res.status;
      } catch {
        status = -1; // 网络错误按 5xx 语义走重试
      }

      if (status >= 200 && status < 300) {
        item.status = 'success';
        item.lastError = null;
        item.nextAttemptAt = null;
        result.sent += 1;
      } else if (status >= 400 && status < 500) {
        // 4xx 不重试，直接死信（含告警）
        await this.deadLetter(item, `HTTP ${status}`);
        result.dead += 1;
      } else {
        item.attempts += 1;
        item.lastError = status === -1 ? 'network-error' : `HTTP ${status}`;
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
}