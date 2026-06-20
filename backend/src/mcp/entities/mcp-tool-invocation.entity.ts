import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum MCPInvocationStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity('mcp_tool_invocations')
@Index('idx_mcp_invocations_tool', ['toolName'])
@Index('idx_mcp_invocations_time', ['createdAt'])
@Index('idx_mcp_idempotency', ['idempotencyKey'], {
  unique: true,
  where: isSqlite ? undefined : 'idempotency_key IS NOT NULL',
})
export class MCPToolInvocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tool_name', type: 'varchar' })
  toolName: string;

  @Column({ type: 'varchar' })
  caller: string;

  @Column({ name: 'request_id', type: 'varchar', nullable: true })
  requestId: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', nullable: true })
  idempotencyKey: string | null;

  @Column({ name: 'input_json', type: isSqlite ? 'simple-json' : 'jsonb', nullable: true })
  inputJson: Record<string, unknown> | null;

  @Column({ name: 'output_json', type: isSqlite ? 'simple-json' : 'jsonb', nullable: true })
  outputJson: unknown;

  @Column({ type: 'varchar', default: MCPInvocationStatus.SUCCESS })
  status: MCPInvocationStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
