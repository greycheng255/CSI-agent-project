import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export const GATEWAY_KEY_STATUS = ['active', 'rotated', 'revoked'] as const;
export type GatewayKeyStatus = (typeof GATEWAY_KEY_STATUS)[number];

/**
 * Workspace 级 LLM 网关密钥（指南(2) §3.7.2 K1-K4 终裁形态）：
 * - K1 签发（幂等）：同 workspace 重复签发返回同一 key（AES-256-GCM 加密存储，
 *   明文仅 daemon 进程内存持有，平台不落明文）；
 * - K2 run 标识注入：daemon 代理经 /keys/validate 换取 workspace/org 归集头；
 * - K3 吊销：销毁/滥用即时 revoke（401 语义）；
 * - K4 轮换：rotate 签发新 key，旧 key 置 rotated（daemon 24h 顺带轮换语义）。
 * key 格式对齐 OneLLM 口径：`sk-csi-<base64url>`，Bearer 调用。
 */
@Entity('gateway_api_keys')
@Index(['workspaceId', 'status'])
export class GatewayApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'org_id', type: isSqlite ? 'varchar' : 'uuid' })
  orgId: string;

  @Column({ name: 'workspace_id', type: isSqlite ? 'varchar' : 'uuid' })
  workspaceId: string;

  /** 公开短标识（wk_ + 8 hex），供管理面/日志引用，不用于鉴权 */
  @Column({ name: 'key_id', type: 'varchar', length: 24, unique: true })
  keyId: string;

  /** 展示前缀（sk-csi-xxxx…），明文不可恢复展示 */
  @Column({ name: 'key_prefix', type: 'varchar', length: 32 })
  keyPrefix: string;

  /** SHA-256(key) 十六进制，验签快速查找 */
  @Column({ name: 'key_hash', type: 'varchar', length: 64, unique: true })
  keyHash: string;

  /** AES-256-GCM(iv+tag+cipher) base64，用于 K1 幂等重取明文 */
  @Column({ name: 'key_ciphertext', type: 'text' })
  keyCiphertext: string;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: GatewayKeyStatus;

  @Column({ name: 'rotated_from_id', type: 'varchar', length: 64, nullable: true })
  rotatedFromId: string | null;

  @Column({ name: 'revoked_at', type: isSqlite ? 'datetime' : 'timestamp with time zone', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'issued_at' })
  issuedAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
