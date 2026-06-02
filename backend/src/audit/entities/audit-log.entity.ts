import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum ActorType {
  CLIENT = 'CLIENT',
  OWNER = 'OWNER',
  AGENT = 'AGENT',
  SYSTEM = 'SYSTEM',
  ADMIN = 'ADMIN',
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'actor_type',
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: ActorType,
  })
  actorType: ActorType;

  @Column({
    name: 'actor_id',
    type: isSqlite ? 'text' : 'uuid',
    nullable: true,
  })
  actorId: string | null;

  @Column({ type: 'text' })
  action: string;

  @Column({ name: 'entity_type', type: 'text' })
  entityType: string;

  @Column({ name: 'entity_id', type: isSqlite ? 'text' : 'uuid' })
  entityId: string;

  @Column({ type: isSqlite ? 'simple-json' : 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
