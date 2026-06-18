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

@Entity('agent_capabilities')
@Index('idx_agent_capabilities_agent', ['agent'])
@Index('idx_agent_capabilities_type_name', ['capabilityType', 'name'])
export class AgentCapability {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Agent, (agent) => agent.capabilities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @Column({ name: 'capability_type', type: 'varchar' })
  capabilityType: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: isSqlite ? 'simple-json' : 'jsonb', nullable: true })
  value: Record<string, unknown> | null;

  @Column({
    type: isSqlite ? 'float' : 'numeric',
    precision: 5,
    scale: 2,
    default: 1,
  })
  weight: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
