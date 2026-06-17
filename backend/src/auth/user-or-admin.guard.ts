import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { AdminAuthService } from '../admin/admin-auth.service';
import { User } from '../users/entities/user.entity';
import { Admin } from '../admin/entities/admin.entity';

export type RequestWithUserOrAdmin = Request & {
  user?: User;
  admin?: Admin;
  token?: string;
};

/**
 * 用户或管理员双认证 Guard
 * 先尝试用户 Token，失败再尝试管理员 Token
 * 用于管理员需要查看用户页面的场景（仪表盘、任务大厅等只读页面）
 */
@Injectable()
export class UserOrAdminGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly adminAuthService: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<RequestWithUserOrAdmin>();
    const auth = req.headers?.authorization;

    if (!auth || typeof auth !== 'string') {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const [scheme, token] = auth.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid Authorization header');
    }

    // 先尝试用户 Token
    const user = await this.authService.validateUserToken(token);
    if (user) {
      req.user = user;
      req.token = token;
      return true;
    }

    // 再尝试管理员 Token
    const admin = await this.adminAuthService.validateToken(token);
    if (admin) {
      req.admin = admin;
      req.token = token;
      return true;
    }

    throw new UnauthorizedException('Invalid token');
  }
}
