import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Admin } from './admin.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

/**
 * 管理员访问令牌
 * 与用户令牌完全分离
 */
@Entity('admin_access_tokens')
export class AdminAccessToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Admin, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'admin_id' })
  admin: Admin;

  @Column({ name: 'admin_id' })
  adminId: string;

  @Column({ name: 'token_hash' })
  tokenHash: string;

  @Column({
    name: 'expires_at',
    nullable: true,
    type: isSqlite ? 'datetime' : 'timestamp',
  })
  expiresAt: Date;

  @Column({
    name: 'revoked_at',
    nullable: true,
    type: isSqlite ? 'datetime' : 'timestamp',
  })
  revokedAt: Date;

  @Column({
    name: 'last_used_at',
    nullable: true,
    type: isSqlite ? 'datetime' : 'timestamp',
  })
  lastUsedAt: Date;

  @Column({ name: 'ip_address', nullable: true, type: 'varchar' })
  ipAddress: string;

  @Column({ name: 'user_agent', nullable: true, type: 'text' })
  userAgent: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /**
   * 检查令牌是否有效
   */
  isValid(): boolean {
    if (this.revokedAt) {
      return false;
    }
    if (this.expiresAt && this.expiresAt.getTime() <= Date.now()) {
      return false;
    }
    return true;
  }
}
