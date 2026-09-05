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
