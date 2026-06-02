import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Bid } from '../../bids/entities/bid.entity';
import { Order } from '../../orders/entities/order.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum TaskStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_user_id', nullable: true })
  clientUserId: string;

  @ManyToOne(() => User, (user) => user.tasks, { nullable: true })
  @JoinColumn({ name: 'client_id' })
  client: User;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'acceptance_criteria', type: 'text', nullable: true })
  acceptanceCriteria: string;

  @Column({ name: 'budget_cny', type: 'int', nullable: true })
  budgetCny: number;

  @Column({
    name: 'expected_delivery_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  expectedDeliveryAt: Date;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: TaskStatus,
    default: TaskStatus.DRAFT,
  })
  status: TaskStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => Bid, (bid) => bid.task)
  bids: Bid[];

  @OneToMany(() => Order, (order) => order.task)
  orders: Order[];
}
