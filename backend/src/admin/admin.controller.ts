import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  UnauthorizedException,
  Headers,
  Ip,
  Param,
  Query,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthService } from './admin-auth.service';
import {
  AdminGuard,
  SuperAdminGuard,
  AdminPermissionGuard,
} from './admin.guard';
import { RequirePermission } from './admin-permission.decorator';
import { Admin, AdminLevel } from './entities/admin.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import {
  ALL_ADMIN_PERMISSIONS,
  ADMIN_PERMISSION_GROUPS,
  ADMIN_PERMISSIONS,
} from './admin-permissions';

// 扩展 Request 类型
declare module 'express' {
  interface Request {
    admin?: Admin;
  }
}

/**
 * 管理员登录请求
 */
interface AdminLoginDto {
  username: string;
  password: string;
}

/**
 * 创建管理员请求
 */
interface CreateAdminDto {
  username: string;
  password: string;
  phone?: string;
  email?: string;
  displayName?: string;
  level?: AdminLevel;
  permissions?: string[];
}

/**
 * 管理员控制器
 * 所有 /api/v1/admin/* 路由都需要管理员权限
 */
@Controller('api/v1/admin')
export class AdminController {
  constructor(
    private readonly adminAuthService: AdminAuthService,
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  /**
   * 管理员登录
   * POST /api/v1/admin/login
   */
  @Post('login')
  async login(
    @Body() body: AdminLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.adminAuthService.login(
      body.username,
      body.password,
      ip,
      userAgent,
    );
  }

  /**
   * 管理员登出
   * POST /api/v1/admin/logout
   */
  @Post('logout')
  @UseGuards(AdminGuard)
  async logout(@Req() req: any, @Headers('authorization') auth: string) {
    const token = auth?.replace('Bearer ', '');
    if (token) {
      await this.adminAuthService.revokeToken(token);
    }
    return { message: '登出成功' };
  }

  /**
   * 获取当前管理员信息
   * GET /api/v1/admin/me
   */
  @Get('me')
  @UseGuards(AdminGuard)
  getCurrentAdmin(@Req() req: Request) {
    const admin = req.admin as Admin;
    return {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      level: admin.level,
      permissions: admin.getPermissions(),
      lastLoginAt: admin.lastLoginAt,
      loginIp: admin.loginIp,
    };
  }

  /**
   * 修改管理员密码
   * POST /api/v1/admin/change-password
   */
  @Post('change-password')
  @UseGuards(AdminGuard)
  async changePassword(
    @Req() req: Request,
    @Body() body: { oldPassword: string; newPassword: string },
  ) {
    const admin = req.admin as Admin;
    await this.adminAuthService.changePassword(
      admin.id,
      body.oldPassword,
      body.newPassword,
    );
    return { message: '密码修改成功' };
  }

  /**
   * 创建新管理员（仅超级管理员）
   * POST /api/v1/admin/create
   */
  @Post('create')
  @UseGuards(SuperAdminGuard)
  async createAdmin(@Req() req: Request, @Body() body: CreateAdminDto) {
    const creator = req.admin as Admin;
    const newAdmin = await this.adminAuthService.createAdmin(creator.id, body);
    return {
      message: '管理员创建成功',
      admin: {
        id: newAdmin.id,
        username: newAdmin.username,
        displayName: newAdmin.displayName,
        level: newAdmin.level,
      },
    };
  }

  /**
   * 获取可用权限列表（用于前端编辑页面）
   * GET /api/v1/admin/permissions
   */
  @Get('permissions')
  @UseGuards(SuperAdminGuard)
  getPermissionsList() {
    return {
      permissions: ALL_ADMIN_PERMISSIONS,
      groups: ADMIN_PERMISSION_GROUPS,
    };
  }

  /**
   * 编辑管理员（仅超级管理员）
   * POST /api/v1/admin/:id/update
   */
  @Post(':id/update')
  @UseGuards(SuperAdminGuard)
  async updateAdmin(
    @Param('id') id: string,
    @Body()
    body: {
      level?: string;
      permissions?: string[];
      status?: string;
      displayName?: string;
    },
  ) {
    const admin = await this.adminRepository.findOne({ where: { id } });
    if (!admin) {
      throw new UnauthorizedException('管理员不存在');
    }

    if (body.level && ['SUPER', 'ADMIN', 'OPERATOR'].includes(body.level)) {
      admin.level = body.level as AdminLevel;
    }
    if (body.permissions) {
      admin.permissions = JSON.stringify(body.permissions);
    }
    if (body.status && ['ACTIVE', 'DISABLED'].includes(body.status)) {
      admin.status = body.status as any;
    }
    if (body.displayName) {
      admin.displayName = body.displayName;
    }

    await this.adminRepository.save(admin);
    return {
      message: '管理员更新成功',
      admin: {
        id: admin.id,
        username: admin.username,
        displayName: admin.displayName,
        level: admin.level,
        status: admin.status,
        permissions: admin.getPermissions(),
      },
    };
  }

  /**
   * 获取管理员列表（仅超级管理员）
   * GET /api/v1/admin/list
   */
  @Get('list')
  @UseGuards(SuperAdminGuard)
  async getAdminList() {
    const admins = await this.adminRepository.find({
      select: [
        'id',
        'username',
        'displayName',
        'phone',
        'email',
        'level',
        'status',
        'permissions',
        'createdAt',
        'lastLoginAt',
        'loginIp',
      ],
      order: { createdAt: 'DESC' },
    });
    return {
      data: admins.map((a) => ({
        ...a,
        permissions: (() => {
          try { return JSON.parse(a.permissions || '[]'); } catch { return []; }
        })(),
      })),
      total: admins.length,
    };
  }

  /**
   * 获取操作日志
   * GET /api/v1/admin/audit-logs?page=1&limit=50&action=&entityType=&actorType=
   */
  @Get('audit-logs')
  @UseGuards(SuperAdminGuard)
  async getAuditLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('actorType') actorType?: string,
  ) {
    // AuditLog entity is not directly available in AdminModule,
    // use a raw query via the admin repository's manager
    const p = parseInt(page || '1');
    const l = Math.min(parseInt(limit || '50'), 200);
    const offset = (p - 1) * l;

    const qb = this.adminRepository.manager
      .createQueryBuilder()
      .select('*')
      .from('audit_logs', 'log')
      .orderBy('log.created_at', 'DESC')
      .offset(offset)
      .limit(l);

    if (action) qb.andWhere('log.action = :action', { action });
    if (entityType) qb.andWhere('log.entity_type = :entityType', { entityType });
    if (actorType) qb.andWhere('log.actor_type = :actorType', { actorType });

    const [data, total] = await Promise.all([
      qb.getRawMany(),
      this.adminRepository.manager
        .createQueryBuilder()
        .select('COUNT(*)', 'count')
        .from('audit_logs', 'log')
        .getRawOne(),
    ]);

    return {
      data,
      pagination: {
        page: p,
        limit: l,
        total: parseInt(total?.count || '0'),
        totalPages: Math.ceil(parseInt(total?.count || '0') / l),
      },
    };
  }

  /**
   * 获取用户列表（管理员权限）
   * GET /api/v1/admin/users
   */
  @Get('users')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(ADMIN_PERMISSIONS.USER_VIEW)
  async getUserList() {
    const users = await this.usersRepository.find({
      select: [
        'id',
        'phone',
        'displayName',
        'email',
        'kycStatus',
        'createdAt',
      ],
      order: { createdAt: 'DESC' },
    });
    return {
      data: users,
      total: users.length,
    };
  }
}
