import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Agent } from './agent.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

@Entity('agent_credentials')
export class AgentCredential {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Agent, (agent) => agent.id, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @Column({ type: 'text', nullable: true })
  name: string | null;

  @Column({ name: 'key_id', type: 'varchar', unique: true })
  keyId: string;

  @Column({ name: 'secret_hash', type: 'text', unique: true })
  secretHash: string;

  @Column({
    name: 'scopes',
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  scopes: string[] | null;

  @Column({ name: 'status', type: 'varchar', default: 'active' })
  status: 'active' | 'revoked' | 'expired';

  @Column({
    name: 'expires_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  expiresAt: Date | null;

  @Column({
    name: 'revoked_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  revokedAt: Date | null;

  @Column({
    name: 'last_used_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  lastUsedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
