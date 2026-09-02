import { Column, Entity, PrimaryColumn } from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

/**
 * HMAC nonce 去重表（对接指南 §3.1 接收方验证流程第 3 步「nonce 唯一」）。
 * nonce 取通用请求头 X-Request-Id；TTL 覆盖 2×5min 时间窗漂移，防窗口内重放。
 */
@Entity('hmac_nonces')
export class HmacNonce {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  nonce: string;

  @Column({ name: 'expires_at', type: isSqlite ? 'datetime' : 'timestamptz' })
  expiresAt: Date;
}
