import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export const WORKSPACE_DISPLAY_STATUS = [
  'active',
  'suspended',
  'frozen',
] as const;
export type WorkspaceDisplayStatus =
  (typeof WORKSPACE_DISPLAY_STATUS)[number];

/**
 * Workspace 投影表（长任务线，决策 D1）：
 * 承载雇主展示页（PRD §5.6.7）+ 商机投递目标 + 竞标主体关联。
 * 展示信息同步方式待与 Console 约定（执行方案 §7 风险 1）。
 */
@Entity('workspaces')
export class Workspace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 归属 Agent Owner（平台既有 users 表），改造语义：工作室是卖方主体升级，绑定现有用户 */
  @Column({
    name: 'owner_user_id',
    type: isSqlite ? 'varchar' : 'uuid',
    nullable: true,
  })
  ownerUserId: string | null;

  @Column({ name: 'org_id', type: isSqlite ? 'varchar' : 'uuid', nullable: true })
  orgId: string | null;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  slug: string;

  @Column({ name: 'logo_url', type: 'text', nullable: true })
  logoUrl: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column(
    isSqlite
      ? { name: 'category_ids', type: 'simple-json', nullable: true }
      : { name: 'category_ids', type: 'text', array: true, nullable: true },
  )
  categoryIds: string[] | null;

  @Column(
    isSqlite
      ? { name: 'capability_tags', type: 'simple-json', nullable: true }
      : { name: 'capability_tags', type: 'text', array: true, nullable: true },
  )
  capabilityTags: string[] | null;

  @Column({
    name: 'service_commitments',
    type: isSqlite ? 'simple-json' : 'jsonb',
    default: () => "'{}'",
  })
  serviceCommitments: Record<string, unknown>;

  @Column({
    name: 'display_status',
    type: 'varchar',
    length: 32,
    default: 'active',
  })
  displayStatus: WorkspaceDisplayStatus;

  @Column({ name: 'receive_platform_push', type: 'boolean', default: true })
  receivePlatformPush: boolean;

  @Column({ name: 'auto_bid_enabled', type: 'boolean', default: true })
  autoBidEnabled: boolean;

  @Column({ name: 'completed_tasks_count', type: 'int', default: 0 })
  completedTasksCount: number;

  @Column({
    name: 'avg_rating',
    type: isSqlite ? 'float' : 'numeric',
    precision: 3,
    scale: 2,
    default: 0,
  })
  avgRating: number;

  @Column({
    name: 'on_time_rate',
    type: isSqlite ? 'float' : 'numeric',
    precision: 5,
    scale: 4,
    default: 0,
  })
  onTimeRate: number;

  @Column({
    name: 'dispute_rate',
    type: isSqlite ? 'float' : 'numeric',
    precision: 5,
    scale: 4,
    default: 0,
  })
  disputeRate: number;

  @Column({
    name: 'showcase_cases',
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  showcaseCases: unknown[] | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  announcement: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}