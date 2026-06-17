/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthService } from './admin-auth.service';
import { Admin, AdminLevel } from './entities/admin.entity';
import { PERMISSION_KEY } from './admin-permission.decorator';

/**
 * 管理员认证 Guard
 * 验证请求是否来自合法的管理员（任意级别）
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private adminAuthService: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('缺少认证令牌');
    }

    const admin = await this.adminAuthService.validateToken(token);

    if (!admin) {
      throw new UnauthorizedException('无效的认证令牌');
    }

    request.admin = admin;
    return true;
  }

  private extractToken(request: any): string | null {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return null;
  }
}

/**
 * 超级管理员 Guard
 * 仅允许超级管理员访问
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private adminAuthService: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('缺少认证令牌');
    }

    const admin = await this.adminAuthService.validateToken(token);

    if (!admin) {
      throw new UnauthorizedException('无效的认证令牌');
    }

    if (admin.level !== AdminLevel.SUPER) {
      throw new UnauthorizedException('需要超级管理员权限');
    }

    request.admin = admin;
    return true;
  }

  private extractToken(request: any): string | null {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return null;
  }
}

/**
 * 管理员权限 Guard
 * 先验证管理员身份，再检查特定权限
 * 配合 @RequirePermission() 装饰器使用
 * SUPER 管理员自动通过所有权限检查
 */
@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(
    private adminAuthService: AdminAuthService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('缺少认证令牌');
    }

    const admin = await this.adminAuthService.validateToken(token);

    if (!admin) {
      throw new UnauthorizedException('无效的认证令牌');
    }

    // 读取 @RequirePermission() 设置的权限
    const requiredPermission = this.reflector.getAllAndOverride<string>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredPermission) {
      if (!admin.hasPermission(requiredPermission)) {
        throw new UnauthorizedException(
          `权限不足，需要: ${requiredPermission}`,
        );
      }
    }

    request.admin = admin;
    return true;
  }

  private extractToken(request: any): string | null {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return null;
  }
}
