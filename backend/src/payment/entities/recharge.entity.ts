import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 余额充值单（复用支付宝电脑网站支付链路，与订单支付 payments 表分离）。
 * 金额单位：分。outTradeNo 前缀 RCH（订单支付为 CSI），回调按前缀分流。
 */
export enum RechargeStatus {
  INIT = 'INIT', // 待支付
  PAID = 'PAID', // 已入账
  FAILED = 'FAILED', // 超时/关闭
}

@Entity('recharge_orders')
@Index(['userId', 'createdAt'])
export class RechargeOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'varchar' })
  userId: string;

  @Column({ name: 'out_trade_no', type: 'text', unique: true })
  outTradeNo: string;

  @Column({ name: 'trade_no', type: 'text', nullable: true })
  tradeNo: string | null;

  @Column({ name: 'amount_cny', type: 'int' })
  amountCny: number;

  // varchar 而非 PG enum：DB_SYNC=false 环境手动 DDL 更简单
  @Column({ type: 'varchar', length: 16, default: RechargeStatus.INIT })
  status: RechargeStatus;

  @Column({ name: 'raw_notify', type: 'jsonb', nullable: true })
  rawNotify: Record<string, unknown> | null;

  @Column({
    name: 'paid_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  paidAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
