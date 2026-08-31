import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export const MARKETPLACE_TASK_STATUS = [
  'draft',
  'open',
  'selected',
  'completed',
  'expired',
  'closed',
  'cancelled',
] as const;
export type MarketplaceTaskStatus = (typeof MARKETPLACE_TASK_STATUS)[number];

/**
 * 长任务任务大厅（Marketplace Task，7 态，PRD 附录 D.1 单一真相）。
 * 席位与轮次时间字段：seat_limit/seat_taken/expires_at/
 * seat_full_deadline/seat_full_locked_at/bid_round/last_reopened_at。
 * 状态枚举英文符号落地前与 Console 对齐一次写入契约（对接指南 §6 陷阱 4）。
 */
@Entity('marketplace_tasks')
export class MarketplaceTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'employer_user_id',
    type: isSqlite ? 'varchar' : 'uuid',
    nullable: true,
  })
  employerUserId: string | null;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'category_id', type: 'varchar', length: 64, nullable: true })
  categoryId: string | null;

  @Column({ name: 'budget_min_cny', type: 'int', nullable: true })
  budgetMinCny: number | null;

  @Column({ name: 'budget_max_cny', type: 'int', nullable: true })
  budgetMaxCny: number | null;

  @Column({
    name: 'expected_delivery_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  expectedDeliveryAt: Date | null;

  @Column(
    isSqlite
      ? { name: 'attachment_urls', type: 'simple-json', nullable: true }
      : { name: 'attachment_urls', type: 'text', array: true, nullable: true },
  )
  attachmentUrls: string[] | null;

  @Column(
    isSqlite
      ? { type: 'simple-json', nullable: true }
      : { type: 'text', array: true, nullable: true },
  )
  tags: string[] | null;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: MARKETPLACE_TASK_STATUS,
    default: 'draft',
  })
  status: MarketplaceTaskStatus;

  @Column({ name: 'seat_limit', type: 'int', default: 20 })
  seatLimit: number;

  @Column({ name: 'seat_taken', type: 'int', default: 0 })
  seatTaken: number;

  @Column({
    name: 'expires_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  expiresAt: Date | null;

  @Column({
    name: 'seat_full_deadline',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  seatFullDeadline: Date | null;

  @Column({
    name: 'seat_full_locked_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  seatFullLockedAt: Date | null;

  @Column({ name: 'bid_round', type: 'int', default: 1 })
  bidRound: number;

  @Column({
    name: 'last_reopened_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  lastReopenedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}