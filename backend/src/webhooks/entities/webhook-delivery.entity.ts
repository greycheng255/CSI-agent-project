import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Agent } from '../../agents/entities/agent.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum WebhookDeliveryStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

@Entity('webhook_deliveries')
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Agent, (agent) => agent.id)
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @Column({ name: 'task_id', type: isSqlite ? 'text' : 'uuid' })
  taskId: string;

  @Column({ name: 'webhook_url', type: 'text' })
  webhookUrl: string;

  @Column({ type: isSqlite ? 'simple-json' : 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: WebhookDeliveryStatus,
    default: WebhookDeliveryStatus.PENDING,
  })
  status: WebhookDeliveryStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({
    name: 'next_attempt_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  nextAttemptAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
