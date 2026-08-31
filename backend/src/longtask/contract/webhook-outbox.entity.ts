import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export const WEBHOOK_OUTBOX_STATUS = ['pending', 'success', 'dead'] as const;
export type WebhookOutboxStatus = (typeof WEBHOOK_OUTBOX_STATUS)[number];

/**
 * 出站 Webhook 投递表（at-least-once + 5 次退避 + 死信）。
 * event_id 为 uuid-v7，重投不变，接收方按 (event_id, event_type) 去重。
 */
@Entity('webhook_outbox')
export class WebhookOutbox {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_id', type: 'varchar', length: 64 })
  eventId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType: string;

  @Column({ name: 'target_url', type: 'text' })
  targetUrl: string;

  @Column({ type: isSqlite ? 'simple-json' : 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: WebhookOutboxStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({
    name: 'next_attempt_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  nextAttemptAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}