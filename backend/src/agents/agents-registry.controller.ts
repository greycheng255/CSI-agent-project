import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentsDiscoveryService } from './agents-discovery.service';
import { AuthGuard } from '../auth/auth.guard';
import type { RequestWithUser } from '../auth/auth.guard';
import { AgentCardJson } from './agent-card.service';

type RegisterAgentBody = {
  name: string;
  description?: string;
  webhookUrl?: string;
  skills?: string[];
  domains?: string[];
  tags?: string[];
  agentMode?: 'kubernetes' | 'external';
  endpointUrl?: string;
  healthUrl?: string;
  cardUrl?: string;
  cardJson?: AgentCardJson;
};

type HeartbeatBody = {
  status?: string;
  latencyMs?: number;
  latency_ms?: number;
  load?: number;
  load_metric?: number;
  metadata?: Record<string, unknown>;
};

@Controller('api/v1/agents')
export class AgentsRegistryController {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly discoveryService: AgentsDiscoveryService,
  ) {}

  @Post('register')
  @UseGuards(AuthGuard)
  register(@Body() body: RegisterAgentBody, @Req() req: RequestWithUser) {
    const ownerId = req.user?.id;
    if (!ownerId) throw new ForbiddenException('User ID not found in token');
    return this.agentsService.registerExternal(body, ownerId);
  }

  @Post('register-external')
  @UseGuards(AuthGuard)
  registerExternal(
    @Body() body: RegisterAgentBody,
    @Req() req: RequestWithUser,
  ) {
    const ownerId = req.user?.id;
    if (!ownerId) throw new ForbiddenException('User ID not found in token');
    return this.agentsService.registerExternal(body, ownerId);
  }

  @Get('discover')
  discover(
    @Query('query') query?: string,
    @Query('tags') tags?: string,
    @Query('skills') skills?: string,
    @Query('domains') domains?: string,
    @Query('runtime_status') runtimeStatus?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.discoveryService.discover({
      query,
      tags,
      skills,
      domains,
      runtimeStatus,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Post('search')
  search(@Body() body: Record<string, unknown>) {
    return this.discoveryService.discover({
      query: typeof body.query === 'string' ? body.query : undefined,
      tags: Array.isArray(body.tags)
        ? body.tags.filter((tag) => typeof tag === 'string')
        : typeof body.tags === 'string'
          ? body.tags
          : undefined,
      skills: Array.isArray(body.skills)
        ? body.skills.filter((skill) => typeof skill === 'string')
        : typeof body.skills === 'string'
          ? body.skills
          : undefined,
      domains: Array.isArray(body.domains)
        ? body.domains.filter((domain) => typeof domain === 'string')
        : typeof body.domains === 'string'
          ? body.domains
          : undefined,
      runtimeStatus:
        typeof body.runtime_status === 'string'
          ? body.runtime_status
          : undefined,
      limit: typeof body.limit === 'number' ? body.limit : undefined,
      offset: typeof body.offset === 'number' ? body.offset : undefined,
    });
  }

  @Get('tags')
  listTags() {
    return this.discoveryService.listTags();
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.agentsService.findOneWithDetails(id);
  }

  @Post(':id/heartbeat')
  heartbeat(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: HeartbeatBody,
  ) {
    return this.agentsService.heartbeatWithPayload(id, body);
  }

  @Post(':id/disable')
  @UseGuards(AuthGuard)
  disable(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.agentsService.disable(id, req.user?.id);
  }

  @Post(':id/enable')
  @UseGuards(AuthGuard)
  enable(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.agentsService.enable(id, req.user?.id);
  }
}
