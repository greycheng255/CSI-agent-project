import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export const SETTLEMENT_STATUS = ['pending', 'settled', 'appeal_closed'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUS)[number];

/**
 * 长任务结算单（D3：平台只备数据，真实资金划款交关联方结算支付版块）。
 * 一个 Project 仅一次结算（order_id UNIQUE，对接指南 §3.2.5）。
 */
@Entity('marketplace_settlements')
export class MarketplaceSettlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: isSqlite ? 'varchar' : 'uuid', unique: true })
  orderId: string;

  @Column({ name: 'workspace_id', type: isSqlite ? 'varchar' : 'uuid' })
  workspaceId: string;

  @Column({ name: 'amount_cny', type: 'int', default: 0 })
  amountCny: number;

  @Column({
    name: 'milestone_breakdown',
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  milestoneBreakdown: unknown | null;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status: SettlementStatus;

  @Column({
    name: 'triggered_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  triggeredAt: Date | null;

  @Column({
    name: 'completed_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}