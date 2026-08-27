import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Agent } from './agent.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

@Entity('agent_heartbeats')
@Index('idx_agent_heartbeats_agent', ['agent'])
@Index('idx_agent_heartbeats_time', ['reportedAt'])
export class AgentHeartbeat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Agent, (agent) => agent.heartbeats, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @Column({ type: 'varchar' })
  status: string;

  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  latencyMs: number | null;

  @Column({
    name: 'load_metric',
    type: isSqlite ? 'float' : 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  loadMetric: number | null;

  @Column({ type: isSqlite ? 'simple-json' : 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'reported_at' })
  reportedAt: Date;
}
