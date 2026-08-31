import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export const DELIVERY_STATUS = [
  'submitted',
  'accepted',
  'rejected',
  'revision_requested',
  'auto_accepted',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUS)[number];

/**
 * 长任务交付物记录（场景五）。
 * 幂等键：UNIQUE(order_id, submission_seq)（对接指南 §3.2.5）。
 * 文件本体在对象存储，平台只存 metadata + 签名 URL。
 */
@Entity('marketplace_deliveries')
@Unique(['orderId', 'submissionSeq'])
export class MarketplaceDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: isSqlite ? 'varchar' : 'uuid' })
  orderId: string;

  @Column({ name: 'submission_seq', type: 'int', default: 1 })
  submissionSeq: number;

  @Column({
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  metadata: Record<string, unknown> | null;

  @Column({
    name: 'artifact_urls',
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  artifactUrls: string[] | null;

  @Column({ type: 'varchar', length: 24, default: 'submitted' })
  status: DeliveryStatus;

  @Column({ name: 'review_round', type: 'int', default: 0 })
  reviewRound: number;

  @Column({
    name: 'submitted_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  submittedAt: Date | null;

  @Column({
    name: 'accept_deadline',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  acceptDeadline: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}