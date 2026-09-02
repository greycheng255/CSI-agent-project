import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

/**
 * 订阅套餐（DR-12 / PRD §4.6）。
 * LLM token 额度按订阅周期滚动重置；-1 = 无限（Local 语义）。
 */
@Entity('entitlement_plans')
export class EntitlementPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  /** active | deprecated */
  @Column({ type: 'varchar', length: 32, default: 'active' })
  status: string;

  /** 订阅周期天数（额度滚动重置锚点） */
  @Column({ name: 'period_days', type: 'int', default: 30 })
  periodDays: number;

  /** 周期总量 token 额度（-1 = 无限） */
  @Column({ name: 'total_tokens', type: isSqlite ? 'bigint' : 'bigint', default: -1 })
  totalTokens: number;

  /**
   * 周期总量 credits 额度（媒体生成计费单位，按张/按秒；-1 = 无限）。
   * OneLLM 口径：异步任务提交时预扣费冻结，终态结算或退款（onellm_media_skill.md §10.4）。
   */
  @Column({ name: 'total_credits', type: 'bigint', default: -1 })
  totalCredits: number;

  /** 云端 RuntimeInstance 数上限（-1 = 无上限） */
  @Column({
    name: 'max_runtime_instances',
    type: 'int',
    default: -1,
  })
  maxRuntimeInstances: number;

  /** 可部署 RuntimeProfile/Version 范围（"*" = 通配） */
  @Column({
    name: 'runtime_profiles',
    type: isSqlite ? 'simple-json' : 'jsonb',
    default: () => "'[\"*\"]'",
  })
  runtimeProfiles: string[];

  @Column({ name: 'price_cents', type: 'bigint', default: 0 })
  priceCents: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

/** 套餐可用 LLM 模型目录（E2 ModelEntry） */
@Entity('entitlement_plan_models')
@Index(['planId'])
export class EntitlementPlanModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'plan_id', type: isSqlite ? 'varchar' : 'uuid' })
  planId: string;

  /** 平台模型标识（与 L1 chat 的 model 参数同一命名空间） */
  @Column({ name: 'model_id', type: 'varchar', length: 128 })
  modelId: string;

  /** lite | standard | flagship（网关无 tier 时为空） */
  @Column({ type: 'varchar', length: 32, nullable: true })
  tier: string | null;

  /** chat | image | video | audio | tts | music（OneLLM /v1/media/models 口径） */
  @Column({ name: 'model_type', type: 'varchar', length: 16, default: 'chat' })
  modelType: string;

  /** 套餐旗舰模型（创建页高亮） */
  @Column({ type: 'boolean', default: false })
  flagship: boolean;
}
