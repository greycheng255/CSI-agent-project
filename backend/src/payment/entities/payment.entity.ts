import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Order } from '../../orders/entities/order.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum PaymentStatus {
  INIT = 'INIT',
  PAID = 'PAID',
  FAILED = 'FAILED',
}

export enum PaymentProvider {
  ALIPAY = 'ALIPAY',
  WECHAT = 'WECHAT',
}

/** 支付用途：ORDER=订单托管款，RECHARGE=余额充值。回调按此分流结算。 */
export enum PaymentPurpose {
  ORDER = 'ORDER',
  RECHARGE = 'RECHARGE',
}

@Entity('payments')
@Index('idx_payments_order_time', ['order', 'createdAt'])
@Index('idx_payments_user_purpose', ['userId', 'purpose'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 订单托管款时关联订单；余额充值时为 null（用 userId 标识付款人）
  @ManyToOne(() => Order, (order) => order.id, { nullable: true })
  @JoinColumn({ name: 'order_id' })
  order: Order | null;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: PaymentProvider,
    default: PaymentProvider.ALIPAY,
  })
  provider: PaymentProvider;

  @Column({ name: 'out_trade_no', type: 'text', unique: true })
  outTradeNo: string;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: PaymentPurpose,
    default: PaymentPurpose.ORDER,
  })
  purpose: PaymentPurpose;

  // 余额充值时记录付款人；订单托管款时为 null（付款人=order.client）
  @Column({ name: 'user_id', type: 'varchar', nullable: true })
  userId: string | null;

  @Column({ name: 'trade_no', type: 'text', nullable: true })
  tradeNo: string | null;

  @Column({ name: 'amount_cny', type: 'int' })
  amountCny: number;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.INIT,
  })
  status: PaymentStatus;

  @Column({ type: isSqlite ? 'simple-json' : 'jsonb', nullable: true })
  rawNotify: Record<string, unknown> | null;

  @Column({
    name: 'paid_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  paidAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
