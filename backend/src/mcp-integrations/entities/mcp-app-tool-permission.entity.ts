import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

@Entity('mcp_app_tool_permissions')
@Index('idx_mcp_app_tool_permissions_app_tool', ['appId', 'toolName'], {
  unique: true,
})
export class MCPAppToolPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'app_id', type: isSqlite ? 'text' : 'uuid' })
  appId: string;

  @Column({ name: 'tool_name', type: 'varchar' })
  toolName: string;

  @Column({ type: isSqlite ? 'boolean' : 'bool', default: true })
  enabled: boolean;

  @Column({ name: 'rate_limit_per_minute', type: 'int', nullable: true })
  rateLimitPerMinute: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
