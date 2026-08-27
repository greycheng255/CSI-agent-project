import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum MCPAppToolDirection {
  EXTERNAL = 'external',
  PLATFORM = 'platform',
}

@Entity('mcp_app_tools')
@Index('idx_mcp_app_tools_app_direction_name', ['appId', 'direction', 'name'], {
  unique: true,
})
export class MCPAppTool {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'app_id', type: isSqlite ? 'text' : 'uuid' })
  appId: string;

  @Column({ type: 'varchar' })
  direction: MCPAppToolDirection;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    name: 'input_schema',
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  inputSchema: Record<string, unknown> | null;

  @Column({ name: 'is_write', type: isSqlite ? 'boolean' : 'bool', default: false })
  isWrite: boolean;

  @Column({
    name: 'requires_idempotency',
    type: isSqlite ? 'boolean' : 'bool',
    default: false,
  })
  requiresIdempotency: boolean;

  @Column({ type: isSqlite ? 'boolean' : 'bool', default: true })
  enabled: boolean;

  @Column({
    name: 'last_seen_at',
    type: isSqlite ? 'datetime' : 'timestamp',
    nullable: true,
  })
  lastSeenAt: Date | null;

  @Column({
    name: 'last_called_at',
    type: isSqlite ? 'datetime' : 'timestamp',
    nullable: true,
  })
  lastCalledAt: Date | null;

  @Column({ name: 'last_status', type: 'varchar', nullable: true })
  lastStatus: string | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
