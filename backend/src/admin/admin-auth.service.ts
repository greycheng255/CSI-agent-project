import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, createHash } from 'crypto';
import { Admin, AdminLevel, AdminStatus } from './entities/admin.entity';
import { AdminAccessToken } from './entities/admin-access-token.entity';

@Injectable()
export class AdminAuthService {
  constructor(
    @InjectRepository(Admin)
    private adminRepository: Repository<Admin>,
    @InjectRepository(AdminAccessToken)
    private accessTokensRepository: Repository<AdminAccessToken>,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private hashPassword(password: string): string {
    return createHash('sha256').update(password).digest('hex');
  }

  /**
   * 管理员登录
   */
  async login(
    username: string,
    password: string,
    ip?: string,
    userAgent?: string,
  ) {
    const admin = await this.adminRepository.findOne({
      where: [{ username }, { phone: username }],
    });

    if (!admin) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    if (admin.status === AdminStatus.DISABLED) {
      throw new UnauthorizedException('账号已被禁用');
    }

    if (admin.status === AdminStatus.PENDING) {
      throw new UnauthorizedException('账号待审核');
    }

    const passwordHash = this.hashPassword(password);
    if (admin.passwordHash !== passwordHash) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 更新登录信息
    admin.lastLoginAt = new Date();
    admin.loginIp = ip || '';
    await this.adminRepository.save(admin);

    // 签发令牌
    const token = await this.issueToken(admin, ip, userAgent);

    return {
      message: '登录成功',
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        displayName: admin.displayName,
        level: admin.level,
        permissions: admin.getPermissions(),
      },
    };
  }

  /**
   * 签发管理员令牌
   */
  async issueToken(
    admin: Admin,
    ip?: string,
    userAgent?: string,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);

    const tokenEntity = new AdminAccessToken();
    tokenEntity.admin = admin;
    tokenEntity.adminId = admin.id;
    tokenEntity.tokenHash = tokenHash;
    tokenEntity.ipAddress = ip || '';
    tokenEntity.userAgent = userAgent || '';
    await this.accessTokensRepository.save(tokenEntity);

    return token;
  }

  /**
   * 验证管理员令牌
   */
  async validateToken(token: string): Promise<Admin | null> {
    const tokenHash = this.hashToken(token);
    const row = await this.accessTokensRepository.findOne({
      where: { tokenHash },
      relations: ['admin'],
    });

    if (!row) {
      return null;
    }

    if (!row.isValid()) {
      return null;
    }

    // 更新最后使用时间
    row.lastUsedAt = new Date();
    await this.accessTokensRepository.save(row);

    return row.admin || null;
  }

  /**
   * 撤销令牌
   */
  async revokeToken(token: string): Promise<void> {
    const tokenHash = this.hashToken(token);
    const row = await this.accessTokensRepository.findOne({
      where: { tokenHash },
    });

    if (!row || row.revokedAt) {
      return;
    }

    row.revokedAt = new Date();
    await this.accessTokensRepository.save(row);
  }

  /**
   * 创建管理员（仅超级管理员可调用）
   */
  async createAdmin(
    creatorId: string,
    data: {
      username: string;
      password: string;
      phone?: string;
      email?: string;
      displayName?: string;
      level?: AdminLevel;
      permissions?: string[];
    },
  ): Promise<Admin> {
    // 检查创建者权限
    const creator = await this.adminRepository.findOne({
      where: { id: creatorId },
    });

    if (!creator || creator.level !== AdminLevel.SUPER) {
      throw new UnauthorizedException('只有超级管理员可以创建管理员');
    }

    // 检查用户名是否已存在
    const existing = await this.adminRepository.findOne({
      where: [{ username: data.username }, { phone: data.phone }],
    });

    if (existing) {
      throw new UnauthorizedException('用户名或手机号已存在');
    }

    const admin = new Admin();
    admin.username = data.username;
    admin.passwordHash = this.hashPassword(data.password);
    admin.phone = data.phone || '';
    admin.email = data.email || '';
    admin.displayName = data.displayName || '';
    admin.level = data.level || AdminLevel.ADMIN;
    admin.status = AdminStatus.ACTIVE;
    admin.permissions = data.permissions
      ? JSON.stringify(data.permissions)
      : '';
    admin.createdBy = creatorId;

    return this.adminRepository.save(admin);
  }

  /**
   * 初始化超级管理员（系统首次启动时调用）
   */
  async initSuperAdmin(): Promise<void> {
    const count = await this.adminRepository.count();
    if (count > 0) {
      return; // 已有管理员，跳过
    }

    // 创建默认超级管理员
    const admin = this.adminRepository.create({
      username: 'admin',
      passwordHash: this.hashPassword('Qwer081213'),
      displayName: '系统管理员',
      level: AdminLevel.SUPER,
      status: AdminStatus.ACTIVE,
      permissions: JSON.stringify(['*']),
    });

    await this.adminRepository.save(admin);
    console.log('[Admin] 默认超级管理员已创建: admin / Qwer081213');
  }
}
