import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Bid } from '../../bids/entities/bid.entity';

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
}
