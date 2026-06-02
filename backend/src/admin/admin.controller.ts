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
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard, SuperAdminGuard } from './admin.guard';
import { Admin, AdminLevel } from './entities/admin.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../users/entities/user.entity';

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
 * 修改用户角色请求
 */
interface UpdateUserRoleDto {
  role: UserRole;
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
    };
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
        'createdAt',
        'lastLoginAt',
      ],
      order: { createdAt: 'DESC' },
    });
    return {
      data: admins,
      total: admins.length,
    };
  }

  /**
   * 修改用户角色（仅超级管理员）
   * POST /api/v1/admin/users/:userId/role
   */
  @Post('users/:userId/role')
  @UseGuards(SuperAdminGuard)
  async updateUserRole(
    @Param('userId') userId: string,
    @Body() body: UpdateUserRoleDto,
  ) {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    // 更新角色
    user.role = body.role;
    await this.usersRepository.save(user);

    return {
      message: '用户角色更新成功',
      user: {
        id: user.id,
        phone: user.phone,
        role: user.role,
      },
    };
  }

  /**
   * 获取用户列表（管理员权限）
   * GET /api/v1/admin/users
   */
  @Get('users')
  @UseGuards(AdminGuard)
  async getUserList() {
    const users = await this.usersRepository.find({
      select: [
        'id',
        'phone',
        'displayName',
        'email',
        'role',
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
