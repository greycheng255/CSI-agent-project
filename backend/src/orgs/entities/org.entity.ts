import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

/**
 * 统一账户体系 Org 模型（2026-08-28 Owner 裁决归属）。
 *
 * 公测版口径：账号注册时默认分配生成并绑定一个 org，该账号在此 org 为
 * owner 角色（一账号多 Workspace 共享权益）。多 org / 成员邀请 / 角色分配 /
 * 切换属 IAM 域，公测不建（演进预留）。
 *
 * org_id 作为不透明计费主体键（§3.7.3），被计费版块（§4.5）与 Console、
 * EntitlementPort、网关 key 共同消费。账号→org 解析以 OIDC 登录态 claim
 * 首选，OrgController 解析 API 兜底。
 */
@Entity('orgs')
export class Org {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 拥有此 org 的账号；公测版一账号一 org（unique） */
  @Index({ unique: true })
  @Column({ name: 'owner_user_id', type: isSqlite ? 'varchar' : 'uuid' })
  ownerUserId: string;

  /** 机器友好的 slug（全局唯一，自动生成） */
  @Index({ unique: true })
  @Column({ type: 'text' })
  slug: string;

  /** 展示名（默认与账号 displayName 同源） */
  @Column({ type: 'text' })
  name: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
