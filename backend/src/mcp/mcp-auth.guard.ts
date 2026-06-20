import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { MCPAppIntegration } from '../mcp-integrations/entities';

@Injectable()
export class MCPAuthGuard implements CanActivate {
  constructor(
    @InjectRepository(MCPAppIntegration)
    private readonly appsRepository: Repository<MCPAppIntegration>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { mcpApp?: MCPAppIntegration }>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing MCP token');
    }

    const expected = process.env.MCP_SERVER_TOKEN;
    const token = auth.slice('Bearer '.length).trim();
    if (expected && token === expected) {
      return true;
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const app = await this.appsRepository.findOne({
      where: { mcpTokenHash: tokenHash, enabled: true },
    });
    if (!app) {
      throw new UnauthorizedException('Invalid MCP token');
    }

    req.mcpApp = app;
    return true;
  }
}
