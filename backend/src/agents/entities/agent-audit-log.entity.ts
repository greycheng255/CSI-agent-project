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
import { User } from '../../users/entities/user.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

@Entity('agent_audit_logs')
@Index('idx_agent_audit_logs_agent', ['agent'])
@Index('idx_agent_audit_logs_action', ['action'])
export class AgentAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Agent, (agent) => agent.auditLogs, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'actor_user_id' })
  actor: User | null;

  @Column({ type: 'varchar' })
  action: string;

  @Column({
    name: 'before_value',
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  beforeValue: Record<string, unknown> | null;

  @Column({
    name: 'after_value',
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  afterValue: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
