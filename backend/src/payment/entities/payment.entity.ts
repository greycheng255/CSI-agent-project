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

@Entity('payments')
@Index('idx_payments_order_time', ['order', 'createdAt'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, (order) => order.id)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: PaymentProvider,
    default: PaymentProvider.ALIPAY,
  })
  provider: PaymentProvider;

  @Column({ name: 'out_trade_no', type: 'text', unique: true })
  outTradeNo: string;

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
