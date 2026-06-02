/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { Admin, AdminLevel } from './entities/admin.entity';

/**
 * 管理员权限装饰器数据
 */
export interface AdminGuardOptions {
  requiredLevel?: AdminLevel;
  requiredPermission?: string;
}

/**
 * 管理员认证 Guard
 * 验证请求是否来自合法的管理员
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

    // 将管理员信息附加到请求对象
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
 * 管理员权限 Guard（带特定权限检查）
 */
@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(
    private adminAuthService: AdminAuthService,
    private requiredPermission: string,
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

    if (!admin.hasPermission(this.requiredPermission)) {
      throw new UnauthorizedException(`缺少权限: ${this.requiredPermission}`);
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
