import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

@Entity('mcp_task_bindings')
@Index('idx_mcp_task_bindings_app_external', ['appId', 'externalTaskId'])
@Index('idx_mcp_task_bindings_platform_task', ['platformTaskId'])
@Index('idx_mcp_task_bindings_platform_order', ['platformOrderId'])
export class MCPTaskBinding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'app_id', type: isSqlite ? 'text' : 'uuid' })
  appId: string;

  @Column({ name: 'platform_task_id', type: isSqlite ? 'text' : 'uuid', nullable: true })
  platformTaskId: string | null;

  @Column({ name: 'platform_order_id', type: isSqlite ? 'text' : 'uuid', nullable: true })
  platformOrderId: string | null;

  @Column({ name: 'external_task_id', type: 'varchar', nullable: true })
  externalTaskId: string | null;

  @Column({ name: 'external_tool_name', type: 'varchar', nullable: true })
  externalToolName: string | null;

  @Column({ type: 'varchar', nullable: true })
  status: string | null;

  @Column({ type: 'varchar', nullable: true })
  progress: string | null;

  @Column({ name: 'result_url', type: 'text', nullable: true })
  resultUrl: string | null;

  @Column({
    name: 'result_json',
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  resultJson: unknown;

  @Column({ type: isSqlite ? 'float' : 'numeric', nullable: true })
  cost: number | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({
    name: 'last_polled_at',
    type: isSqlite ? 'datetime' : 'timestamp',
    nullable: true,
  })
  lastPolledAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
