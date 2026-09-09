import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

/**
 * SSO 一次性授权码（10 分钟有效，使用后立即作废）
 */
@Entity('sso_authorization_codes')
@Index('idx_sso_auth_codes_code_hash', ['codeHash'])
export class SsoAuthorizationCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'code_hash', type: 'text' })
  codeHash: string;

  @ManyToOne(() => User, (user) => user.id)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'client_id', type: 'text' })
  clientId: string;

  @Column({ name: 'redirect_uri', type: 'text' })
  redirectUri: string;

  @Column({ name: 'code_challenge', type: 'text', nullable: true })
  codeChallenge: string | null;

  /**
   * OIDC：授权时请求的 scope（空格分隔，如 "openid profile"）。
   * 未携带 scope 时为 null（向后兼容纯 OAuth2 流程，不签发 id_token）。
   */
  @Column({ name: 'scope', type: 'text', nullable: true })
  scope: string | null;

  /**
   * OIDC：客户端在 authorize 传入的 nonce，原样回填至 id_token。
   * 纯 OAuth2 流程下为 null。
   */
  @Column({ name: 'nonce', type: 'text', nullable: true })
  nonce: string | null;

  @Column({
    name: 'expires_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
  })
  expiresAt: Date;

  @Column({
    name: 'used_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
