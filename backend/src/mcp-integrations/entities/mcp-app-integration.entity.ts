import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum MCPAppDirection {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
  BIDIRECTIONAL = 'bidirectional',
}

export enum MCPAppTransport {
  STREAMABLE_HTTP = 'streamable-http',
  HTTP_JSONRPC = 'http-jsonrpc',
}

export enum MCPAppAuthMode {
  NONE = 'none',
  BEARER = 'bearer',
  HEADERS = 'headers',
}

export enum MCPAppHealthStatus {
  HEALTHY = 'healthy',
  WARNING = 'warning',
  FAILED = 'failed',
  UNKNOWN = 'unknown',
}

@Entity('mcp_app_integrations')
@Index('idx_mcp_app_integrations_code', ['code'], { unique: true })
export class MCPAppIntegration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  code: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', default: MCPAppDirection.BIDIRECTIONAL })
  direction: MCPAppDirection;

  @Column({ type: 'varchar', default: MCPAppTransport.STREAMABLE_HTTP })
  transport: MCPAppTransport;

  @Column({ name: 'endpoint_url', type: 'varchar', nullable: true })
  endpointUrl: string | null;

  @Column({ name: 'auth_mode', type: 'varchar', default: MCPAppAuthMode.NONE })
  authMode: MCPAppAuthMode;

  @Column({ name: 'auth_config_encrypted', type: 'text', nullable: true })
  authConfigEncrypted: string | null;

  @Column({ name: 'mcp_token_hash', type: 'varchar', nullable: true })
  mcpTokenHash: string | null;

  @Column({
    name: 'mcp_token_issued_at',
    type: isSqlite ? 'datetime' : 'timestamp',
    nullable: true,
  })
  mcpTokenIssuedAt: Date | null;

  @Column({ name: 'default_workspace_id', type: 'varchar', nullable: true })
  defaultWorkspaceId: string | null;

  @Column({ name: 'default_tenant_id', type: 'varchar', nullable: true })
  defaultTenantId: string | null;

  @Column({ type: isSqlite ? 'boolean' : 'bool', default: true })
  enabled: boolean;

  @Column({
    name: 'health_status',
    type: 'varchar',
    default: MCPAppHealthStatus.UNKNOWN,
  })
  healthStatus: MCPAppHealthStatus;

  @Column({
    name: 'last_checked_at',
    type: isSqlite ? 'datetime' : 'timestamp',
    nullable: true,
  })
  lastCheckedAt: Date | null;

  @Column({
    name: 'last_discovered_at',
    type: isSqlite ? 'datetime' : 'timestamp',
    nullable: true,
  })
  lastDiscoveredAt: Date | null;

  @Column({
    name: 'last_synced_at',
    type: isSqlite ? 'datetime' : 'timestamp',
    nullable: true,
  })
  lastSyncedAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
