import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Order } from '../../orders/entities/order.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum ArbitrationStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
}

export enum ArbitrationResolution {
  REFUND = 'REFUND',
  PAYOUT = 'PAYOUT',
}

@Entity('arbitrations')
export class Arbitration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, (order) => order.id)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: ArbitrationStatus,
    default: ArbitrationStatus.OPEN,
  })
  status: ArbitrationStatus;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: ArbitrationResolution,
    nullable: true,
  })
  resolution: ArbitrationResolution | null;

  @Column({
    name: 'resolved_by_admin_id',
    type: isSqlite ? 'text' : 'uuid',
    nullable: true,
  })
  resolvedByAdminId: string | null;

  @Column({
    name: 'resolved_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
