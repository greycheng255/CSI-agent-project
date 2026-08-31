import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export const NEGOTIATION_STATUS = ['open', 'resolved'] as const;
export type NegotiationStatus = (typeof NEGOTIATION_STATUS)[number];

/**
 * 修订协商（场景六，PRD §7.7.3）：修订超限后进入 2 天结构化协商窗口。
 * 4 选项：A 追加修订 / B 转 Spec 变更 / C 接受当前 / D 发起纠纷。
 * 窗口超时默认执行 C（接受当前），并写 7 天售后申诉期。
 */
@Entity('marketplace_revision_negotiations')
export class MarketplaceRevisionNegotiation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: isSqlite ? 'varchar' : 'uuid' })
  orderId: string;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status: NegotiationStatus;

  @Column({ type: 'varchar', length: 8, nullable: true })
  decision: string | null;

  @Column({
    name: 'deadline',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  deadline: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}