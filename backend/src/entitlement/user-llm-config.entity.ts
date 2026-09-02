import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

/**
 * 用户 AI 网关配置（BYOK：Bring Your Own Key）。
 * 平台不卖套餐/不收支付，用户自带网关地址 + API Key：
 * 方案一 = 用户自己的网关；方案二 = OneLLM（onellm.opennotebook.chat）购买后创建 key 回填。
 * api_key AES-256-GCM 加密存储，明文不落库、不回显。
 */
@Entity('user_llm_configs')
export class UserLlmConfig {
  /** 用户 org id（users.id） */
  @PrimaryColumn({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @Column({ name: 'base_url', type: 'varchar', length: 255 })
  baseUrl: string;

  @Column({ name: 'api_key_enc', type: 'text' })
  apiKeyEnc: string;

  /** 明文 key 前缀（如 sk-7cb9ef），用于页面掩码展示 */
  @Column({ name: 'key_prefix', type: 'varchar', length: 16 })
  keyPrefix: string;

  @CreateDateColumn({ name: 'created_at', type: isSqlite ? 'datetime' : 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: isSqlite ? 'datetime' : 'timestamptz' })
  updatedAt: Date;
}
