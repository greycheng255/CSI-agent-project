import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { RequestWithUser } from './auth.guard';
import { UserRole } from '../users/entities/user.entity';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const requiredRoles =
      this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || [];

    if (requiredRoles.length === 0) return true;

    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const role = req.user?.role;
    if (!role) throw new ForbiddenException('Missing role');
    if (!requiredRoles.includes(role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
