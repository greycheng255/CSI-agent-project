import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Task } from '../../tasks/entities/task.entity';
import { Bid } from '../../bids/entities/bid.entity';
import { User } from '../../users/entities/user.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum OrderStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  IN_PROGRESS = 'IN_PROGRESS',
  DELIVERED = 'DELIVERED',
  ACCEPTED = 'ACCEPTED',
  PENDING_RELEASE = 'PENDING_RELEASE', // 待平台放款
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
  ARBITRATING = 'ARBITRATING',
  REFUNDED = 'REFUNDED',
  CANCELED = 'CANCELED',
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Task, (task) => task.orders)
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @ManyToOne(() => Bid, (bid) => bid.orders, { nullable: true })
  @JoinColumn({ name: 'bid_id' })
  bid: Bid;

  @Column({ name: 'bid_id', type: 'uuid', nullable: true })
  bidId: string | null;

  @Column({ name: 'client_user_id', type: 'varchar', length: 255, nullable: true })
  clientUserId: string;

  @ManyToOne(() => User, (user) => user.clientOrders, { nullable: true })
  @JoinColumn({ name: 'client_id' })
  client: User;

  @Column({ name: 'owner_user_id', type: 'varchar', length: 255, nullable: true })
  ownerUserId: string;

  @ManyToOne(() => User, (user) => user.ownerOrders, { nullable: true })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @Column({ name: 'amount_cny', type: 'int' })
  amountCny: number;

  @Column({
    name: 'platform_fee_rate',
    type: isSqlite ? 'float' : 'numeric',
    precision: 3,
    scale: 2,
  })
  platformFeeRate: number;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING_PAYMENT,
  })
  status: OrderStatus;

  @Column({
    name: 'escrowed_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  escrowedAt: Date | null;

  @Column({
    name: 'delivered_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  deliveredAt: Date | null;

  @Column({
    name: 'released_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  releasedAt: Date | null;

  @Column({ name: 'platform_fee_cny', type: 'int', nullable: true })
  platformFeeCny: number | null;

  @Column({ name: 'payout_cny', type: 'int', nullable: true })
  payoutCny: number | null;

  @Column({ name: 'delivery_summary', type: 'text', nullable: true })
  deliverySummary: string | null;

  @Column({ name: 'delivery_url', type: 'text', nullable: true })
  deliveryUrl: string | null;

  @Column({ name: 'dispute_reason', type: 'text', nullable: true })
  disputeReason: string | null;

  @Column({
    name: 'accepted_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  acceptedAt: Date | null;

  @Column({
    name: 'refunded_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  refundedAt: Date | null;

  @Column({
    name: 'canceled_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  canceledAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'current_delivery_id', type: 'uuid', nullable: true })
  currentDeliveryId: string | null;

  @Column({ name: 'delivery_count', type: 'int', default: 0 })
  deliveryCount: number;

  @Column({ name: 'max_delivery_attempts', type: 'int', default: 3 })
  maxDeliveryAttempts: number;
}
