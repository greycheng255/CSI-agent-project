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

@Entity('agent_cards')
@Index('idx_agent_cards_agent', ['agent'])
export class AgentCard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Agent, (agent) => agent.cards, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @Column({ name: 'schema_version', type: 'varchar', default: '1.0.0' })
  schemaVersion: string;

  @Column({ type: 'varchar' })
  version: string;

  @Column({ name: 'card_json', type: isSqlite ? 'simple-json' : 'jsonb' })
  cardJson: Record<string, unknown>;

  @Column({ name: 'content_hash', type: 'varchar' })
  contentHash: string;

  @Column({ type: 'text', nullable: true })
  signature: string | null;

  @Column({ type: 'varchar', default: 'manual' })
  source: 'platform' | 'remote_fetch' | 'manual';

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({
    name: 'fetched_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  fetchedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
