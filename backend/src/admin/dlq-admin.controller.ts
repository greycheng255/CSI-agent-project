import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AdminGuard } from '../admin/admin.guard';
import { WebhookOutbox } from '../longtask/contract/webhook-outbox.entity';
import { NotificationOutbox } from '../wechat/notification-outbox.entity';

const DLQ_MAX_REPLAY_IDS = 200;

const TYPE_TO_ENTITY = {
  webhook: WebhookOutbox,
  notification: NotificationOutbox,
} as const;
type DlqType = keyof typeof TYPE_TO_ENTITY;

interface DeadRow {
  id: string;
  event_type: string;
  target: string | null;
  attempts: number;
  last_error: string | null;
  next_attempt_at: Date | null;
  created_at: Date;
}

/**
 * DLQ（死信）运维管理 API：查看各出口事务 outbox（webhook/notification）的
 * 死信明细，并对 status='dead' 的记录一键重放（置回 pending，交回 cron 续投）。
 * 鉴权复用管理员会话（AdminGuard，Bearer adminToken）。
 */
@Controller('api/v1/admin/dlq')
@UseGuards(AdminGuard)
export class DlqAdminController {
  constructor(
    @InjectRepository(WebhookOutbox)
    private readonly webhookRepo: Repository<WebhookOutbox>,
    @InjectRepository(NotificationOutbox)
    private readonly notifRepo: Repository<NotificationOutbox>,
  ) {}

  private repo(type: DlqType): Repository<WebhookOutbox> | Repository<NotificationOutbox> {
    return this.webhookRepo.manager.getRepository(TYPE_TO_ENTITY[type]) as never;
  }

  /** 死信明细（仅 status='dead'，分页，按创建时间倒序） */
  @Get('dead')
  async dead(
    @Query('type') type: DlqType,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    if (!type || !(type in TYPE_TO_ENTITY)) {
      return { error: `type must be one of ${Object.keys(TYPE_TO_ENTITY).join('|')}` };
    }
    const page = Math.max(1, Number(pageRaw) || 1);
    const limit = Math.min(200, Math.max(1, Number(limitRaw) || 20));
    const qb = this.repo(type)
      .createQueryBuilder('o')
      .where('o.status = :st', { st: 'dead' })
      .orderBy('o.created_at', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit);
    const [rows, total] = await qb.getManyAndCount();
    const data: DeadRow[] = rows.map((r) => ({
      id: r.id,
      event_type: r.eventType,
      target: (r as unknown as { targetUrl?: string }).targetUrl ?? null,
      attempts: r.attempts,
      last_error: r.lastError,
      next_attempt_at: r.nextAttemptAt,
      created_at: r.createdAt,
    }));
    return { data, page, limit, total };
  }

  /**
   * 一键重放：仅对 status='dead' 的记录重置为 pending + attempts=0 + nextAttemptAt=now，
   * 由现有 cron/dispatcher 按 next_attempt_at 自动续投。WHERE status='dead' 防止并发误重放。
   */
  @Post('replay')
  async replay(@Body() body: { type: DlqType; ids?: string[] }) {
    const { type, ids } = body ?? {};
    if (!type || !(type in TYPE_TO_ENTITY)) {
      return { error: `type must be one of ${Object.keys(TYPE_TO_ENTITY).join('|')}` };
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return { error: 'ids[] required' };
    }
    if (ids.length > DLQ_MAX_REPLAY_IDS) {
      return { error: `replay batch limit ${DLQ_MAX_REPLAY_IDS}` };
    }
    const repo = this.repo(type) as Repository<WebhookOutbox>;
    const res = await repo
      .createQueryBuilder()
      .update()
      .set({ status: 'pending' as never, attempts: 0, nextAttemptAt: new Date(), lastError: null })
      .where({ id: In(ids), status: 'dead' })
      .execute();
    return { replayed: res.affected ?? 0, pending_ids: ids.length };
  }
}