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

@Entity('agent_api_keys')
export class AgentApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Agent, (agent) => agent.id)
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @Column({ type: 'text', nullable: true })
  name: string | null;

  @Column({ name: 'key_hash', type: 'text', unique: true })
  keyHash: string;

  @Column({ name: 'key_id', type: 'varchar', nullable: true, unique: true })
  keyId: string | null;

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
