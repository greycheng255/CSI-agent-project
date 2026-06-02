import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { User } from '../users/entities/user.entity';

export type RequestWithUser = Request & { user: User; token?: string };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const auth = req.headers?.authorization;
    console.log('[AuthGuard] Authorization header:', auth);
    if (!auth || typeof auth !== 'string') {
      throw new UnauthorizedException('Missing Authorization header');
    }
    const [scheme, token] = auth.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid Authorization header');
    }

    console.log('[AuthGuard] Validating token:', token.substring(0, 20) + '...');
    const user = await this.authService.validateUserToken(token);
    console.log('[AuthGuard] User from token:', user);
    if (!user) {
      throw new UnauthorizedException('Invalid token');
    }
    req.user = user;
    req.token = token;
    console.log('[AuthGuard] Authentication successful, userId:', user.id);
    return true;
  }
}
