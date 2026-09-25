import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 雇主主动发起的消息（M→C，复用对接指南 §13.3 的 employer-reply 通道）。
 *
 * 与入站 `employer_mentions`（Console 推来的 @employer 提问）分开存储：
 * 后者的 `mention_id uuid NOT NULL UNIQUE` 是入站语义，被
 * `receiveEmployerMention` 的幂等与 404/422 语义依赖，无法承载
 * 「雇主新开一条消息」这种没有 mention 的场景。
 *
 * 幂等键 = 前端生成的 `client_message_id`（唯一约束）；
 * 出站 webhook 的 event_id 显式取本行 `id`，DLQ replay 复用同一 id 供 Console 去重。
 */
@Entity('employer_outbound_messages')
@Index('idx_employer_outbound_order', ['orderId'])
export class EmployerOutboundMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @Column({ name: 'project_task_id', type: 'uuid', nullable: true })
  projectTaskId: string | null;

  @Column({ name: 'employer_user_id', type: 'uuid', nullable: true })
  employerUserId: string | null;

  /** 幂等键：前端生成，重复提交不新增行、不重复投递 */
  @Column({ name: 'client_message_id', type: 'uuid', unique: true })
  clientMessageId: string;

  @Column({
    name: 'from_type',
    type: 'varchar',
    length: 32,
    default: 'employer',
  })
  fromType: string;

  @Column({
    name: 'from_display_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  fromDisplayName: string | null;

  /** { text, attachments[] } */
  @Column({ type: 'jsonb' })
  content: Record<string, unknown>;

  /** 收件人语义提示（如 [{type:'agent_owner'}]）；具体人由 Console 按 workspace 反查 */
  @Column({ type: 'jsonb', nullable: true })
  addressees: Array<Record<string, unknown>> | null;

  /** queued：已入 outbox 待投递（投递结果由 webhook_outbox 负责） */
  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
