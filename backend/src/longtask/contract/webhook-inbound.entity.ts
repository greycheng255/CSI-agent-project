import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

/**
 * 入站 Webhook 去重账本：UNIQUE(event_id, event_type)。
 * 同一事件重投时 event_id 不变，重复投递不是 bug 是设计内行为。
 */
@Entity('inbound_webhook_events')
@Unique(['eventId', 'eventType'])
export class WebhookInboundEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_id', type: 'varchar', length: 64 })
  eventId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType: string;

  @Column({ type: isSqlite ? 'simple-json' : 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'received_at' })
  receivedAt: Date;
}