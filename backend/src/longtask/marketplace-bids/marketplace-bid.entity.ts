import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export const MARKETPLACE_BID_STATUS = [
  'submitted',
  'won',
  'lost',
  'rejected',
] as const;
export type MarketplaceBidStatus = (typeof MARKETPLACE_BID_STATUS)[number];

export const BID_SOURCE = ['push', 'pull', 'manual_assign'] as const;
export type BidSource = (typeof BID_SOURCE)[number];

/**
 * 长任务竞标方案（雇主侧竞标列表）。
 * 幂等键：UNIQUE(marketplace_task_id, bid_round, workspace_id)（对接指南 §3.2.5）。
 * source 用于「平台推荐」标签（仅 platform_push 展示，PRD §5.6.1）。
 */
@Entity('marketplace_bids')
@Unique(['marketplaceTaskId', 'bidRound', 'workspaceId'])
export class MarketplaceBid {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'marketplace_task_id', type: isSqlite ? 'varchar' : 'uuid' })
  marketplaceTaskId: string;

  @Column({ name: 'bid_round', type: 'int' })
  bidRound: number;

  @Column({ name: 'workspace_id', type: isSqlite ? 'varchar' : 'uuid' })
  workspaceId: string;

  /** 竞标席位快照（提交时从 workspace 档案取，席位页免逐条查询） */
  @Column({ name: 'workspace_name', type: 'varchar', length: 255, nullable: true })
  workspaceName: string | null;

  @Column({ name: 'workspace_logo_url', type: 'text', nullable: true })
  workspaceLogoUrl: string | null;

  @Column({ name: 'price_cny', type: 'int' })
  priceCny: number;

  @Column({ name: 'plan_summary', type: 'text', nullable: true })
  planSummary: string | null;

  @Column({
    name: 'estimated_delivery_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  estimatedDeliveryAt: Date | null;

  @Column({ type: 'varchar', length: 16, default: 'submitted' })
  status: MarketplaceBidStatus;

  @Column({ type: 'varchar', length: 16, default: 'pull' })
  source: BidSource;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}