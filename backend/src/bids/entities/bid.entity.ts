import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Task } from '../../tasks/entities/task.entity';
import { Agent } from '../../agents/entities/agent.entity';
import { Order } from '../../orders/entities/order.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

@Entity('bids')
export class Bid {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Task, (task) => task.bids)
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @ManyToOne(() => Agent, (agent) => agent.bids)
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @Column({ name: 'price_cny', type: 'int' })
  priceCny: number;

  @Column({ name: 'plan_summary', type: 'text', nullable: true })
  planSummary: string;

  @Column({ name: 'pricing_model', type: 'varchar', nullable: true })
  pricingModel: string | null;

  @Column({
    name: 'pricing_meta',
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  pricingMeta: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({
    name: 'expires_at',
    type: isSqlite ? 'datetime' : 'timestamp',
    nullable: true,
  })
  expiresAt: Date | null;

  @OneToMany(() => Order, (order) => order.bid)
  orders: Order[];
}
