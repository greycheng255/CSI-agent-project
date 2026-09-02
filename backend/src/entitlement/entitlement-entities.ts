import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export const SUBSCRIPTION_STATUSES = [
  'active',
  'trial',
  'expired',
  'cancelled',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Org/账号级订阅（DR-12）：一份套餐覆盖账号全部 Workspace，
 * 额度全 Org 共享。升级即时生效；降级在周期滚动时生效（pending）。
 */
@Entity('org_subscriptions')
@Index(['orgId', 'status'])
export class OrgSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'org_id', type: isSqlite ? 'varchar' : 'uuid' })
  orgId: string;

  @Column({ name: 'plan_id', type: isSqlite ? 'varchar' : 'uuid' })
  planId: string;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status: SubscriptionStatus;

  @Column({ name: 'period_start', type: isSqlite ? 'datetime' : 'timestamptz' })
  periodStart: Date;

  @Column({ name: 'period_end', type: isSqlite ? 'datetime' : 'timestamptz' })
  periodEnd: Date;

  /** 降级目标套餐（下个计费周期生效） */
  @Column({ name: 'pending_plan_id', type: isSqlite ? 'varchar' : 'uuid', nullable: true })
  pendingPlanId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

/** 额度周期信封（E1 ResetAt = periodEnd；used 按周期累计） */
@Entity('entitlement_quota_periods')
@Index(['orgId', 'periodEnd'])
export class EntitlementQuotaPeriod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'org_id', type: isSqlite ? 'varchar' : 'uuid' })
  orgId: string;

  @Column({ name: 'subscription_id', type: isSqlite ? 'varchar' : 'uuid' })
  subscriptionId: string;

  @Column({ name: 'period_start', type: isSqlite ? 'datetime' : 'timestamptz' })
  periodStart: Date;

  @Column({ name: 'period_end', type: isSqlite ? 'datetime' : 'timestamptz' })
  periodEnd: Date;

  /** 周期总量额度（-1 = 无限） */
  @Column({ name: 'total_tokens', type: 'bigint', default: 0 })
  totalTokens: number;

  @Column({ name: 'used_tokens', type: 'bigint', default: 0 })
  usedTokens: number;

  /** 周期总量 credits（媒体生成；-1 = 无限） */
  @Column({ name: 'total_credits', type: 'bigint', default: 0 })
  totalCredits: number;

  @Column({ name: 'used_credits', type: 'bigint', default: 0 })
  usedCredits: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

/** 公测免费额度信封（E3）：入驻即赠、有有效期、不可转让、耗尽即停 */
@Entity('entitlement_free_grants')
@Index(['orgId'], { unique: true })
export class EntitlementFreeGrant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'org_id', type: isSqlite ? 'varchar' : 'uuid' })
  orgId: string;

  @Column({ name: 'total_tokens', type: 'bigint' })
  totalTokens: number;

  @Column({ name: 'used_tokens', type: 'bigint', default: 0 })
  usedTokens: number;

  /** 公测免费 credits（媒体生成） */
  @Column({ name: 'total_credits', type: 'bigint', default: 0 })
  totalCredits: number;

  @Column({ name: 'used_credits', type: 'bigint', default: 0 })
  usedCredits: number;

  @Column({ name: 'valid_until', type: isSqlite ? 'datetime' : 'timestamptz' })
  validUntil: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

/**
 * 用量明细（E4 run 级；网关计量为唯一权威）。
 * 计量归集键 = workspace_id；增量拉取游标 = 自增 id。
 */
@Entity('entitlement_usage_records')
@Index(['workspaceId', 'id'])
export class EntitlementUsageRecord {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ name: 'org_id', type: isSqlite ? 'varchar' : 'uuid' })
  orgId: string;

  @Column({ name: 'workspace_id', type: isSqlite ? 'varchar' : 'uuid' })
  workspaceId: string;

  /** 关联 agent_task_queue run id（空 = 无法归属 run，滥用检测信号） */
  @Column({ name: 'agent_run_id', type: 'varchar', length: 64, nullable: true })
  agentRunId: string | null;

  @Column({ type: 'varchar', length: 128 })
  model: string;

  /** chat | media（chat 按 token，media 按 credits） */
  @Column({ name: 'usage_type', type: 'varchar', length: 16, default: 'chat' })
  usageType: string;

  @Column({ name: 'input_tokens', type: 'bigint', default: 0 })
  inputTokens: number;

  @Column({ name: 'output_tokens', type: 'bigint', default: 0 })
  outputTokens: number;

  @Column({ name: 'total_tokens', type: 'bigint', default: 0 })
  totalTokens: number;

  /** 媒体生成实际扣费 credits（OneLLM MediaResponse.cost） */
  @Column({ type: 'bigint', default: 0 })
  credits: number;

  /** 网关计价的整数分 */
  @Column({ name: 'cost_cents', type: 'bigint', default: 0 })
  costCents: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

/**
 * 订阅支付单（用户侧开通/升级付费套餐）。
 * 当前 channel=mock 模拟支付；支付版块接入后扩展 alipay 等渠道，单据结构不变。
 */
@Entity('entitlement_payment_orders')
@Index(['orgId', 'status'])
export class EntitlementPaymentOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'org_id', type: isSqlite ? 'varchar' : 'uuid' })
  orgId: string;

  @Column({ name: 'plan_id', type: isSqlite ? 'varchar' : 'uuid' })
  planId: string;

  /** 支付金额（整数分） */
  @Column({ name: 'amount_cents', type: 'bigint' })
  amountCents: number;

  /** pending | paid | cancelled */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: string;

  /** mock | alipay | wechat ... */
  @Column({ type: 'varchar', length: 16, default: 'mock' })
  channel: string;

  /** 渠道侧流水号（mock 为本地生成） */
  @Column({ name: 'channel_trade_no', type: 'varchar', length: 64, nullable: true })
  channelTradeNo: string | null;

  @Column({ name: 'paid_at', type: isSqlite ? 'datetime' : 'timestamptz', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

/**
 * 媒体生成 credits 预扣费冻结单（onellm_media_skill.md §1/§10.4 口径）：
 * 提交时冻结 estimated → 终态 is_final=true 时 settle（按实际扣费）
 * 或 refund（失败全额释放）。taskId 幂等（OneLLM task_id）。
 */
@Entity('entitlement_credit_holds')
@Index(['orgId', 'status'])
export class EntitlementCreditHold {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'org_id', type: isSqlite ? 'varchar' : 'uuid' })
  orgId: string;

  /** OneLLM 媒体任务 task_id，幂等键 */
  @Column({ name: 'task_id', type: 'varchar', length: 64, unique: true })
  taskId: string;

  @Column({ name: 'workspace_id', type: isSqlite ? 'varchar' : 'uuid' })
  workspaceId: string;

  @Column({ name: 'agent_run_id', type: 'varchar', length: 64, nullable: true })
  agentRunId: string | null;

  @Column({ type: 'varchar', length: 128 })
  model: string;

  @Column({ name: 'estimated_credits', type: 'bigint' })
  estimatedCredits: number;

  @Column({ name: 'settled_credits', type: 'bigint', nullable: true })
  settledCredits: number | null;

  /** frozen | settled | refunded */
  @Column({ type: 'varchar', length: 16, default: 'frozen' })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
