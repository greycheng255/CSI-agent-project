import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export const OPPORTUNITY_DISPATCH_MODE = [
  'push',
  'pull',
  'manual_assign',
] as const;
export type OpportunityDispatchMode =
  (typeof OPPORTUNITY_DISPATCH_MODE)[number];

/**
 * 商机投递日志（长任务线）：平台不持有 9 态 Opportunity（Console 侧实体），
 * 只记录"投递给哪个 Workspace"用于 Push 幂等/重投与审计。
 * 幂等键：UNIQUE(marketplace_task_id, workspace_id, bid_round, mode)。
 */
@Entity('opportunity_dispatches')
@Unique(['marketplaceTaskId', 'workspaceId', 'bidRound', 'mode'])
export class OpportunityDispatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'marketplace_task_id', type: 'uuid' })
  marketplaceTaskId: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'bid_round', type: 'int', default: 1 })
  bidRound: number;

  @Column({ type: 'varchar', length: 16 })
  mode: OpportunityDispatchMode;

  @Column({ name: 'pushed_at', type: 'timestamp with time zone', nullable: true })
  pushedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}