import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Order } from '../../orders/entities/order.entity';
import { UserPaymentCode } from './user-payment-code.entity';
import { PlatformPaymentCode } from './platform-payment-code.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum OrderPaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
}

export enum OrderPayoutStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  CONFIRMED = 'CONFIRMED',
}

@Entity('order_payments')
export class OrderPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, (order) => order.id)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ name: 'order_id' })
  orderId: string;

  // 雇主支付信息
  @ManyToOne(() => PlatformPaymentCode, (code) => code.id, { nullable: true })
  @JoinColumn({ name: 'platform_code_id' })
  platformCode: PlatformPaymentCode | null;

  @Column({ name: 'platform_code_id', nullable: true })
  platformCodeId: string | null;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: OrderPaymentStatus,
    default: OrderPaymentStatus.PENDING,
  })
  paymentStatus: OrderPaymentStatus;

  @Column({ name: 'payment_proof_url', type: 'text', nullable: true })
  paymentProofUrl: string | null;

  @Column({
    name: 'paid_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  paidAt: Date | null;

  @Column({
    name: 'payment_confirmed_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  paymentConfirmedAt: Date | null;

  @Column({ name: 'payment_confirmed_by', type: 'uuid', nullable: true })
  paymentConfirmedBy: string | null;

  // 开发者收款信息
  @ManyToOne(() => UserPaymentCode, (code) => code.id, { nullable: true })
  @JoinColumn({ name: 'owner_code_id' })
  ownerCode: UserPaymentCode | null;

  @Column({ name: 'owner_code_id', nullable: true })
  ownerCodeId: string | null;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: OrderPayoutStatus,
    default: OrderPayoutStatus.PENDING,
  })
  payoutStatus: OrderPayoutStatus;

  @Column({ name: 'payout_proof_url', type: 'text', nullable: true })
  payoutProofUrl: string | null;

  @Column({
    name: 'payout_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  payoutAt: Date | null;

  @Column({
    name: 'payout_confirmed_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  payoutConfirmedAt: Date | null;

  @Column({ name: 'payout_confirmed_by', type: 'uuid', nullable: true })
  payoutConfirmedBy: string | null;

  // 金额信息
  @Column({ name: 'amount_cny', type: 'int' })
  amountCny: number;

  @Column({ name: 'platform_fee_cny', type: 'int', default: 0 })
  platformFeeCny: number;

  @Column({ name: 'payout_cny', type: 'int' })
  payoutCny: number;

  @Column({ name: 'remark', type: 'text', nullable: true })
  remark: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
