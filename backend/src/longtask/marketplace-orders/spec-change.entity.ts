import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export const SPEC_CHANGE_STATUS = [
  'requested',
  'classified',
  'proposed',
  'confirmed',
  'rejected',
] as const;
export type SpecChangeStatus = (typeof SPEC_CHANGE_STATUS)[number];

/**
 * Spec 变更请求（场景七）。
 * 幂等键：UNIQUE(order_id, change_seq)（对接指南 §3.2.5）。
 * 确认后 Spec version+1，历史版本不可改。
 */
@Entity('marketplace_spec_changes')
@Unique(['orderId', 'changeSeq'])
export class MarketplaceSpecChange {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: isSqlite ? 'varchar' : 'uuid' })
  orderId: string;

  @Column({ name: 'change_seq', type: 'int', default: 1 })
  changeSeq: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  classification: string | null;

  @Column({ type: 'varchar', length: 16, default: 'requested' })
  status: SpecChangeStatus;

  @Column({
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  payload: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}