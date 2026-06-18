import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Agent } from './agent.entity';

@Entity('agent_tags')
@Unique('uq_agent_tag', ['agent', 'tag'])
@Index('idx_agent_tags_agent', ['agent'])
@Index('idx_agent_tags_tag', ['tag'])
export class AgentTag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Agent, (agent) => agent.tags, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @Column({ type: 'varchar' })
  tag: string;

  @Column({ name: 'tag_type', type: 'varchar', default: 'custom' })
  tagType: 'official' | 'domain' | 'pricing' | 'source' | 'custom';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
