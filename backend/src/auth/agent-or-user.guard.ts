import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { AgentsService } from '../agents/agents.service';
import { User } from '../users/entities/user.entity';

export type RequestWithUserOrAgent = Request & {
  user?: User;
  token?: string;
  agent?: { id: string };
};

@Injectable()
export class AgentOrUserAuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly agentsService: AgentsService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<RequestWithUserOrAgent>();
    const auth = req.headers?.authorization;

    if (!auth || typeof auth !== 'string') {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const [scheme, token] = auth.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid Authorization header');
    }

    // 首先尝试作为 User JWT 验证
    const user = await this.authService.validateUserToken(token);
    if (user) {
      req.user = user;
      req.token = token;
      return true;
    }

    // 然后尝试作为 Agent API Key 验证
    const agent = await this.agentsService.validateAgentApiKey(token);
    if (agent) {
      req.agent = agent;
      req.token = token;
      return true;
    }

    throw new UnauthorizedException('Invalid token or api key');
  }
}
