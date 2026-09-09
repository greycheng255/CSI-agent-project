import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Order } from '../../orders/entities/order.entity';

export enum PayoutStatus {
  INIT = 'INIT',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

@Entity('payouts')
export class Payout {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, (order) => order.id)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ name: 'amount_to_owner_cny', type: 'int' })
  amountToOwnerCny: number;

  @Column({ name: 'amount_fee_cny', type: 'int' })
  amountFeeCny: number;

  @Column({ name: 'provider_ref', type: 'text', nullable: true })
  providerRef: string | null;

  @Column({
    type: 'enum',
    enum: PayoutStatus,
    default: PayoutStatus.INIT,
  })
  status: PayoutStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({
    name: 'completed_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  completedAt: Date | null;
}
