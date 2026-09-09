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

  // 显式暴露 order_id，便于不加载 relations 时直接拿到外键（避免 LEFT JOIN
  // 在悲观锁下与 nullable 侧冲突）。
  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({
    type: 'enum',
    enum: PaymentProvider,
    default: PaymentProvider.ALIPAY,
  })
  provider: PaymentProvider;

  @Column({ name: 'out_trade_no', type: 'text', unique: true })
  outTradeNo: string;

  @Column({
    type: 'enum',
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
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.INIT,
  })
  status: PaymentStatus;

  @Column({ type: 'jsonb', nullable: true })
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
