import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export const DISPUTE_STATUS = [
  'evidence_open',
  'arbitrating',
  'resolved',
  'acknowledged',
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUS)[number];

export const DISPUTE_RESOLUTION = [
  'cancel',
  'fulfill',
  'partial_settlement',
  'refund',
] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTION)[number];

/**
 * 长任务纠纷仲裁（T22，场景十）：3 天举证窗口 → 平台仲裁（最多 7 天）→ 4 选项结果 → 终态确认。
 */
@Entity('marketplace_disputes')
export class MarketplaceDispute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: isSqlite ? 'varchar' : 'uuid' })
  orderId: string;

  @Column({ type: 'varchar', length: 24, default: 'evidence_open' })
  status: DisputeStatus;

  @Column({
    name: 'evidence_deadline',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  evidenceDeadline: Date | null;

  @Column({
    name: 'arbitration_deadline',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  arbitrationDeadline: Date | null;

  @Column({
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  evidence: unknown | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  resolution: DisputeResolution | null;

  @Column({ name: 'resolution_amount_cny', type: 'int', nullable: true })
  resolutionAmountCny: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}