import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * LLM 渠道（上游网关）别名表。
 * 同一套对外模型名（如 multica/Console 沿用的 gpt-5.4 / gpt-5.5）在不同网关的
 * 真实可用模型不同：zen 需改写为 deepseek-v4.1-flash，cherryin 要求 vendor 前缀……
 * 故按渠道主机名分别保存别名表，转发时按当前生效渠道自动读取对应映射。
 */
@Entity('llm_channels')
export class LlmChannel {
  /** 渠道主机名（如 open.cherryin.ai / opencode.ai / api.lk888.ai），唯一标识 */
  @PrimaryColumn({ name: 'host', type: 'varchar', length: 255 })
  host: string;

  /** 展示名 */
  @Column({ name: 'label', type: 'varchar', length: 128, default: '' })
  label: string;

  /** 别名表：调用方模型名 → 上游真实模型名；空对象=原样透传 */
  @Column({ name: 'aliases', type: 'jsonb', default: () => "'{}'" })
  aliases: Record<string, string>;

  /** 备注（渠道口径说明） */
  @Column({ name: 'note', type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
