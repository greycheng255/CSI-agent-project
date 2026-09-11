import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export const NOTIFICATION_OUTBOX_STATUS = [
  'pending',
  'success',
  'dead',
  'skipped',
] as const;
export type NotificationOutboxStatus =
  (typeof NOTIFICATION_OUTBOX_STATUS)[number];

/**
 * 业务通知交付表（微信渠道）。
 * 沿用出站 Webhook outbox 的 at-least-once + 退避 + 死信模式，
 * 由 NotificationDispatcherCron 按 next_attempt_at 轮询消费，避免阻塞支付/结算事务。
 */
@Entity('notification_outbox')
@Unique(['noKey'])
@Index(['status', 'nextAttemptAt'])
export class NotificationOutbox {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 业务幂等键（同一条通知重复入队不重发） */
  @Column({ name: 'no_key', type: 'varchar', length: 128 })
  noKey: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType: string;

  @Column({ type: 'varchar', length: 16, default: 'wechat' })
  channel: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, unknown>;

  @Column({ name: 'template_id', type: 'varchar', length: 128, nullable: true })
  templateId: string | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: NotificationOutboxStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({
    name: 'next_attempt_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  nextAttemptAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}