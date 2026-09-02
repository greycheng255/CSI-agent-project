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

/**
 * 仲裁结果六值（TS §12.2 场景十，Console 清单 A1 项对齐）：
 * - cancel/fulfill/partial_settlement/refund：四类资金处置
 * - resume_execution：仲裁裁定取消不成立回执行（G6 dispute_in_progress→executing，零结算）
 * - closed：平台裁定关闭（G3 dispute_in_progress→closed，零结算）
 */
export const DISPUTE_RESOLUTION = [
  'cancel',
  'fulfill',
  'partial_settlement',
  'refund',
  'resume_execution',
  'closed',
] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTION)[number];

/** 零结算出口（amount_cny 必须为空） */
export const ZERO_SETTLEMENT_RESOLUTIONS: readonly DisputeResolution[] = [
  'resume_execution',
  'closed',
];

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