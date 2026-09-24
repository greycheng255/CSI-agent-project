import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 雇主 Mention（对接指南 §13.2/§13.3）。
 * Console 在 Agent / Agent Owner @employer 时推送；此处为「站内通知位」的持久层：
 * 雇主在订单详情里看到提问并回复，回复经 employer-reply webhook 写回 Console Task Comment。
 * 幂等键 = Console 的 mention_id（唯一约束）。
 */
@Entity('employer_mentions')
@Index('idx_employer_mentions_order', ['orderId'])
export class EmployerMention {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Console 侧 mention_id（幂等键，重复推送不新增行） */
  @Column({ name: 'mention_id', type: 'uuid', unique: true })
  mentionId: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @Column({ name: 'project_task_id', type: 'uuid', nullable: true })
  projectTaskId: string | null;

  @Column({ name: 'source_comment_id', type: 'uuid', nullable: true })
  sourceCommentId: string | null;

  /** 发起方类型：agent / agent_owner */
  @Column({ name: 'from_type', type: 'varchar', length: 32 })
  fromType: string;

  @Column({ name: 'from_id', type: 'uuid', nullable: true })
  fromId: string | null;

  @Column({ name: 'from_display_name', type: 'varchar', length: 255, nullable: true })
  fromDisplayName: string | null;

  /** { text, attachments[] } 原文（回复时原样回传 Console） */
  @Column({ type: 'jsonb' })
  content: Record<string, unknown>;

  @Column({ name: 'related_spec_id', type: 'uuid', nullable: true })
  relatedSpecId: string | null;

  @Column({ name: 'related_spec_version', type: 'int', nullable: true })
  relatedSpecVersion: number | null;

  @Column({ name: 'reply_endpoint_hint', type: 'text', nullable: true })
  replyEndpointHint: string | null;

  /** 收件雇主（订单 employer_user_id，缺省回退任务雇主） */
  @Column({ name: 'employer_user_id', type: 'uuid', nullable: true })
  employerUserId: string | null;

  /** pending → replied */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: string;

  @Column({ type: 'jsonb', nullable: true })
  reply: Record<string, unknown> | null;

  @Column({ name: 'replied_at', type: 'timestamp with time zone', nullable: true })
  repliedAt: Date | null;

  @Column({ name: 'sent_at', type: 'timestamp with time zone', nullable: true })
  sentAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}