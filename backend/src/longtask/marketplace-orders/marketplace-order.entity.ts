import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

/**
 * 长任务订单（Marketplace Order）。
 * 跨版块关联：order_id（本表 id）↔ Console project_id（PATCH 异步回填，容忍空窗口）。
 * contract_status/delivery_status/settlement_status 与 Console Project 状态最终一致。
 */
@Entity('marketplace_orders')
export class MarketplaceOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'project_id',
    type: isSqlite ? 'varchar' : 'uuid',
    nullable: true,
    unique: true,
  })
  projectId: string | null;

  @Column({ name: 'workspace_id', type: isSqlite ? 'varchar' : 'uuid' })
  workspaceId: string;

  @Column({ name: 'marketplace_task_id', type: isSqlite ? 'varchar' : 'uuid' })
  marketplaceTaskId: string;

  @Column({ name: 'bid_id', type: isSqlite ? 'varchar' : 'uuid', nullable: true })
  bidId: string | null;

  @Column({
    name: 'employer_user_id',
    type: isSqlite ? 'varchar' : 'uuid',
    nullable: true,
  })
  employerUserId: string | null;

  @Column({ name: 'final_price_cny', type: 'int', nullable: true })
  finalPriceCny: number | null;

  @Column({ name: 'contract_status', type: 'varchar', length: 32, default: 'signing' })
  contractStatus: string;

  @Column({
    name: 'spec_snapshot',
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  specSnapshot: Record<string, unknown> | null;

  @Column({ name: 'spec_hash', type: 'text', nullable: true })
  specHash: string | null;

  @Column({ name: 'spec_version', type: 'int', default: 0 })
  specVersion: number;

  @Column({
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  milestones: unknown[] | null;

  @Column({ name: 'delivery_status', type: 'varchar', length: 32, nullable: true })
  deliveryStatus: string | null;

  @Column({ name: 'settlement_status', type: 'varchar', length: 32, nullable: true })
  settlementStatus: string | null;

  @Column({
    name: 'after_sale_deadline',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  afterSaleDeadline: Date | null;

  @Column({
    name: 'spec_deadline',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  specDeadline: Date | null;

  @Column({ name: 'spec_rejection_count', type: 'int', default: 0 })
  specRejectionCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}