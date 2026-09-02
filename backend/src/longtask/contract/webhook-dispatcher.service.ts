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

  /** 出站入队（event_id 缺省生成 uuid-v7 语义的 uuid；重投复用同一 id） */
  enqueue(
    eventType: string,
    targetUrl: string,
    payload: Record<string, unknown>,
    eventId?: string,
  ): Promise<WebhookOutbox> {
    const row = this.outboxRepo.create({
      eventId: eventId ?? randomUUID(),
      eventType,
      targetUrl,
      payload,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(),
    });
    return this.outboxRepo.save(row);
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
        item.status = 'dead';
        await this.outboxRepo.save(item);
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
        // 4xx 不重试，直接死信
        item.status = 'dead';
        item.lastError = `HTTP ${status}`;
        result.dead += 1;
      } else {
        item.attempts += 1;
        item.lastError = status === -1 ? 'network-error' : `HTTP ${status}`;
        if (item.attempts >= MAX_WEBHOOK_ATTEMPTS) {
          item.status = 'dead';
          item.nextAttemptAt = null;
          this.logger.error(
            `Webhook dead-lettered after ${MAX_WEBHOOK_ATTEMPTS} attempts | event=${item.eventType} event_id=${item.eventId} target=${item.targetUrl}`,
          );
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