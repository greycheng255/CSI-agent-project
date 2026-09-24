import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

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

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'submission_seq', type: 'int', default: 1 })
  submissionSeq: number;

  @Column({
    type: 'jsonb',
    nullable: true,
  })
  metadata: Record<string, unknown> | null;

  @Column({
    name: 'artifact_urls',
    type: 'jsonb',
    nullable: true,
  })
  artifactUrls: string[] | null;

  @Column({ type: 'varchar', length: 24, default: 'submitted' })
  status: DeliveryStatus;

  @Column({ name: 'review_round', type: 'int', default: 0 })
  reviewRound: number;

  /** Console 回填空送：平台确定性 Gate（G1/G2/G3/G6）是否全部通过。PRD §9.4 自动验收第 1 条硬约束 */
  @Column({
    name: 'gates_all_passed',
    type: 'boolean',
    nullable: true,
  })
  gatesAllPassed: boolean | null;

  /** 已发送的 5/9/13 天催办点位（供自动验收第 2 条硬约束与会话去重） */
  @Column({
    name: 'reminder_days_sent',
    type: 'int',
    array: true,
    default: () => "'{}'",
  })
  reminderDaysSent: number[];

  @Column({
    name: 'submitted_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  submittedAt: Date | null;

  @Column({
    name: 'accept_deadline',
    type: 'timestamp with time zone',
    nullable: true,
  })
  acceptDeadline: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}