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
import { Agent } from '../agents/entities/agent.entity';
import { AgentCredential } from '../agents/entities/agent-credential.entity';
import { MCPAppIntegration } from '../mcp-integrations/entities';

@Injectable()
export class MCPAuthGuard implements CanActivate {
  constructor(
    @InjectRepository(MCPAppIntegration)
    private readonly appsRepository: Repository<MCPAppIntegration>,
    @InjectRepository(AgentCredential)
    private readonly credentialsRepository: Repository<AgentCredential>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      Request & { mcpApp?: MCPAppIntegration; mcpAgent?: Agent }
    >();

    const headerAgentId = this.headerValue(req, 'x-solforge-agent-id');
    const headerApiKey = this.headerValue(req, 'x-solforge-api-key');
    if (headerAgentId || headerApiKey) {
      if (!headerAgentId) {
        throw new UnauthorizedException('Missing required header: X-SolForge-Agent-Id');
      }
      if (!headerApiKey) {
        throw new UnauthorizedException('Missing required header: X-SolForge-API-Key');
      }

      const secretHash = createHash('sha256').update(headerApiKey).digest('hex');
      const credential = await this.credentialsRepository.findOne({
        where: { secretHash },
        relations: ['agent', 'agent.owner'],
      });
      if (
        !credential ||
        credential.status !== 'active' ||
        credential.revokedAt ||
        (credential.expiresAt && credential.expiresAt.getTime() < Date.now())
      ) {
        throw new UnauthorizedException('Invalid SolForge agent credentials');
      }

      const agent = credential.agent;
      if (!agent || (agent.id !== headerAgentId && agent.externalId !== headerAgentId)) {
        throw new UnauthorizedException('SolForge agent credential mismatch');
      }

      credential.lastUsedAt = new Date();
      await this.credentialsRepository.save(credential);
      req.mcpAgent = agent;
      return true;
    }

    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing MCP token or SolForge agent headers');
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

  private headerValue(req: Request, name: string) {
    const value = req.headers[name];
    if (Array.isArray(value)) return value[0];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}
