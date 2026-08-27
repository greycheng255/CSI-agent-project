import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Bid } from '../../bids/entities/bid.entity';
import { AgentCard } from './agent-card.entity';
import { AgentCapability } from './agent-capability.entity';
import { AgentTag } from './agent-tag.entity';
import { AgentHeartbeat } from './agent-heartbeat.entity';
import { AgentAuditLog } from './agent-audit-log.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum AgentStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
}

export enum OpenclawStatus {
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  UNKNOWN = 'UNKNOWN',
}

export enum AgentApprovalStatus {
  DRAFT = 'draft',
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  DISABLED = 'disabled',
}

export enum AgentRuntimeStatus {
  ONLINE = 'online',
  DEGRADED = 'degraded',
  OFFLINE = 'offline',
  UNKNOWN = 'unknown',
}

export enum AgentType {
  PLATFORM_MANAGED = 'platform-managed',
  SELF_HOSTED = 'self-hosted',
}

@Entity('agents')
export class Agent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.agents)
  @JoinColumn({ name: 'owner_user_id' })
  owner: User;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'webhook_url', nullable: true })
  webhookUrl: string;

  @Column(
    isSqlite
      ? { type: 'simple-json', nullable: true }
      : { type: 'text', array: true, nullable: true },
  )
  skills: string[];

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: AgentStatus,
    default: AgentStatus.OFFLINE,
  })
  status: AgentStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({
    name: 'last_heartbeat_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  lastHeartbeatAt: Date | null;

  @Column({ name: 'heartbeat_interval_ms', type: 'int', default: 30000 })
  heartbeatIntervalMs: number;

  @Column({ name: 'consecutive_failures', type: 'int', default: 0 })
  consecutiveFailures: number;

  @OneToMany(() => Bid, (bid) => bid.agent)
  bids: Bid[];

  @OneToMany(() => AgentCard, (card) => card.agent)
  cards: AgentCard[];

  @OneToMany(() => AgentCapability, (capability) => capability.agent)
  capabilities: AgentCapability[];

  @OneToMany(() => AgentTag, (tag) => tag.agent)
  tags: AgentTag[];

  @OneToMany(() => AgentHeartbeat, (heartbeat) => heartbeat.agent)
  heartbeats: AgentHeartbeat[];

  @OneToMany(() => AgentAuditLog, (auditLog) => auditLog.agent)
  auditLogs: AgentAuditLog[];

  @Column({ name: 'pod_name', nullable: true })
  podName: string;

  @Column({ name: 'payment_qr_url', type: 'varchar', nullable: true })
  paymentQrUrl: string;

  @Column({ name: 'payment_qr_type', type: 'varchar', nullable: true })
  paymentQrType: string;

  @Column({ name: 'payment_account', type: 'varchar', nullable: true })
  paymentAccount: string;

  @Column({ name: 'openclaw_url', type: 'varchar', nullable: true })
  openclawUrl: string | null;

  @Column({
    name: 'openclaw_status',
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: OpenclawStatus,
    default: OpenclawStatus.UNKNOWN,
  })
  openclawStatus: OpenclawStatus;

  @Column({
    name: 'last_health_check_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  lastHealthCheckAt: Date | null;

  @Column({
    name: 'health_check_result',
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  healthCheckResult: {
    agentOnline: boolean;
    openclawReachable: boolean;
    skillsLoaded: boolean;
    errors?: string[];
  } | null;

  @Column({ name: 'external_id', nullable: true, unique: true })
  externalId: string;

  @Column({ name: 'agent_mode', type: 'varchar', default: 'kubernetes' })
  agentMode: 'kubernetes' | 'external';

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'agent_type', type: 'varchar', default: AgentType.SELF_HOSTED })
  agentType: AgentType;

  @Column({
    name: 'approval_status',
    type: 'varchar',
    default: AgentApprovalStatus.PENDING_REVIEW,
  })
  approvalStatus: AgentApprovalStatus;

  @Column({
    name: 'runtime_status',
    type: 'varchar',
    default: AgentRuntimeStatus.UNKNOWN,
  })
  runtimeStatus: AgentRuntimeStatus;

  @Column({ name: 'visibility', type: 'varchar', default: 'public' })
  visibility: 'public' | 'private' | 'internal';

  @Column({ name: 'version', type: 'varchar', default: '1.0.0' })
  version: string;

  @Column({ name: 'card_url', type: 'text', nullable: true })
  cardUrl: string | null;

  @Column({ name: 'endpoint_url', type: 'text', nullable: true })
  endpointUrl: string | null;

  @Column({ name: 'health_url', type: 'text', nullable: true })
  healthUrl: string | null;

  @Column({ name: 'auth_type', type: 'varchar', default: 'bearer' })
  authType: 'bearer' | 'api_key' | 'signature' | 'mtls' | 'none';

  @Column({ name: 'pricing_model', type: 'varchar', default: 'quote' })
  pricingModel: string;

  @Column({
    name: 'base_price',
    type: isSqlite ? 'float' : 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  basePrice: number | null;

  @Column({ name: 'currency', type: 'varchar', default: 'CNY' })
  currency: string;

  @Column({
    name: 'reputation_score',
    type: isSqlite ? 'float' : 'numeric',
    precision: 3,
    scale: 2,
    default: 5.0,
  })
  reputationScore: number;

  @Column({
    name: 'approved_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  approvedAt: Date | null;

  @Column({ name: 'contact_email', type: 'varchar', nullable: true })
  contactEmail: string | null;

  @Column({
    name: 'metadata',
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  metadata: Record<string, unknown> | null;
}
