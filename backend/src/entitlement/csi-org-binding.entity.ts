import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * Console workspace → 平台 org 绑定（权威源，§4.2 第 6 项统一账户体系的公测过渡实现）。
 * org_id 为不透明计费主体键；同一 org 可绑定多个 workspace 共享权益。
 * Console 在注册/创建 workspace 时调 POST /v1/orgs/resolve 幂等获取（O1 端点）。
 */
@Entity('csi_org_bindings')
@Index('idx_csi_org_bindings_org_id', ['orgId'])
export class CsiOrgBinding {
  @PrimaryColumn({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  /** 绑定来源：api（Console 调用）/ backfill（存量回填） */
  @Column({ type: 'varchar', length: 32, default: 'api' })
  source: string;

  @Column({
    name: 'resolved_at',
    type: 'timestamp with time zone',
    default: () => 'now()',
  })
  resolvedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
