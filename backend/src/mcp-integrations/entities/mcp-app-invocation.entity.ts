import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum MCPAppInvocationDirection {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
}

export enum MCPAppInvocationStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity('mcp_app_invocations')
@Index('idx_mcp_app_invocations_app_time', ['appId', 'createdAt'])
@Index('idx_mcp_app_invocations_tool', ['toolName'])
export class MCPAppInvocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'app_id', type: isSqlite ? 'text' : 'uuid' })
  appId: string;

  @Column({ type: 'varchar' })
  direction: MCPAppInvocationDirection;

  @Column({ name: 'tool_name', type: 'varchar' })
  toolName: string;

  @Column({
    name: 'request_json',
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  requestJson: unknown;

  @Column({
    name: 'response_json',
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  responseJson: unknown;

  @Column({ type: 'varchar', default: MCPAppInvocationStatus.SUCCESS })
  status: MCPAppInvocationStatus;

  @Column({ name: 'http_status', type: 'int', nullable: true })
  httpStatus: number | null;

  @Column({ name: 'content_type', type: 'varchar', nullable: true })
  contentType: string | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', nullable: true })
  idempotencyKey: string | null;

  @Column({ name: 'platform_task_id', type: isSqlite ? 'text' : 'uuid', nullable: true })
  platformTaskId: string | null;

  @Column({ name: 'platform_order_id', type: isSqlite ? 'text' : 'uuid', nullable: true })
  platformOrderId: string | null;

  @Column({ name: 'external_task_id', type: 'varchar', nullable: true })
  externalTaskId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
