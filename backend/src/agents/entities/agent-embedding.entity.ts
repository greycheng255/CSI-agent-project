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

@Entity('agent_embeddings')
@Index('idx_agent_embeddings_agent', ['agent'])
export class AgentEmbedding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @Column({ name: 'embedding_type', type: 'varchar', default: 'profile' })
  embeddingType: string;

  @Column({ name: 'text_content', type: 'text' })
  textContent: string;

  @Column({ type: 'text', nullable: true })
  embedding: string | null;

  @Column({ type: 'varchar', nullable: true })
  model: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
