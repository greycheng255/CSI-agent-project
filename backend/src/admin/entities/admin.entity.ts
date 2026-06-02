/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

/**
 * 管理员权限级别
 */
export enum AdminLevel {
  SUPER = 'SUPER',
  ADMIN = 'ADMIN',
  OPERATOR = 'OPERATOR',
}

/**
 * 管理员状态
 */
export enum AdminStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
  PENDING = 'PENDING',
}

/**
 * 管理员实体
 * 与 User 完全分离，独立管理
 */
@Entity('admins')
export class Admin {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  username: string;

  @Column({ nullable: true, type: 'varchar' })
  phone: string;

  @Column({ nullable: true, type: 'varchar' })
  email: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: AdminLevel,
    default: AdminLevel.ADMIN,
  })
  level: AdminLevel;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: AdminStatus,
    default: AdminStatus.ACTIVE,
  })
  status: AdminStatus;

  @Column({ name: 'display_name', nullable: true, type: 'varchar' })
  displayName: string;

  @Column({
    name: 'last_login_at',
    nullable: true,
    type: isSqlite ? 'datetime' : 'timestamp',
  })
  lastLoginAt: Date;

  @Column({ name: 'login_ip', nullable: true, type: 'varchar' })
  loginIp: string;

  @Column({ name: 'permissions', type: 'text', nullable: true })
  permissions: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'created_by', nullable: true, type: 'varchar' })
  createdBy: string;

  /**
   * 检查是否有指定权限
   */
  hasPermission(permission: string): boolean {
    if (this.level === AdminLevel.SUPER) {
      return true;
    }
    if (!this.permissions) {
      return false;
    }
    try {
      const perms = JSON.parse(this.permissions);
      return perms.includes(permission) || perms.includes('*');
    } catch {
      return false;
    }
  }

  /**
   * 获取权限列表
   */
  getPermissions(): string[] {
    if (this.level === AdminLevel.SUPER) {
      return ['*'];
    }
    if (!this.permissions) {
      return [];
    }
    try {
      return JSON.parse(this.permissions);
    } catch {
      return [];
    }
  }
}
