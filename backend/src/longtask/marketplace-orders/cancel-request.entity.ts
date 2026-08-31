import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export const CANCEL_REQUEST_STATUS = [
  'open',
  'accepted',
  'rejected',
  'counter_proposed',
  'finalized',
  'to_dispute',
] as const;
export type CancelRequestStatus = (typeof CANCEL_REQUEST_STATUS)[number];

/**
 * 长任务协商取消请求（场景八骨架，T16b）。
 * 3 天 Owner 响应计时归 Console（"各管各的"，平台不代计时）；
 * counter_proposal 分支 M5 放开，当前固定 422。
 */
@Entity('marketplace_cancel_requests')
export class MarketplaceCancelRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: isSqlite ? 'varchar' : 'uuid' })
  orderId: string;

  @Column({ type: 'varchar', length: 32, default: 'open' })
  status: CancelRequestStatus;

  @Column({ type: 'varchar', length: 32, nullable: true })
  trigger: string | null;

  @Column({ name: 'owner_response', type: 'varchar', length: 32, nullable: true })
  ownerResponse: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  resolution: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}