import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  BadRequestException,
  ParseUUIDPipe,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { RequestWithUser } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

type CreateAgentDto = {
  name: string;
  description?: string;
  webhookUrl?: string;
  skills?: string[];
  podName?: string;
  externalId?: string;
  agentMode?: 'kubernetes' | 'external';
};

type UpdateSkillsBody = {
  skills?: unknown;
};

type CreateApiKeyBody = {
  name?: unknown;
};

type UpdatePaymentBody = {
  paymentQrUrl?: string;
  paymentQrType?: string;
  paymentAccount?: string;
};

@Controller('api/v1/owner/agents')
export class AgentsController {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  create(@Body() body: CreateAgentDto, @Req() req: RequestWithUser) {
    // 自动从 JWT 获取当前用户 ID 作为 ownerId
    const ownerId = req.user?.id;
    if (!ownerId) {
      throw new ForbiddenException('User ID not found in token');
    }
    return this.agentsService.create(body, ownerId);
  }

  @Post('upsert')
  // 不使用 @UseGuards，让方法自己处理认证（支持 Agent API Key 和 User JWT）
  async upsert(@Body() body: CreateAgentDto, @Req() req: RequestWithUser) {
    console.log('[DEBUG] upsert called, headers:', JSON.stringify(req.headers));

    // 必须提供 externalId 用于查找或创建
    if (!body.externalId) {
      throw new ForbiddenException('externalId is required for upsert');
    }

    // 尝试从 Authorization header 获取认证信息
    const auth = req.headers?.authorization;
    console.log('[DEBUG] auth header:', auth);

    if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length).trim();
      console.log('[DEBUG] token:', token);

      // 首先尝试作为 Agent API Key 验证
      const agent = await this.agentsService.validateAgentApiKey(token);
      console.log('[DEBUG] agent from api key:', agent);

      if (agent) {
        // Agent 只能更新自己的信息
        console.log('[DEBUG] Using Agent API Key, agentId:', agent.id);
        return this.agentsService.upsertByExternalIdForAgent(body, agent.id);
      }

      // 然后尝试作为 User JWT 验证
      const user = await this.authService.validateUserToken(token);
      console.log('[DEBUG] user from token:', user);
      if (user?.id) {
        console.log('[DEBUG] Using user JWT, userId:', user.id);
        return this.agentsService.upsertByExternalId(body, user.id);
      }
    }

    throw new ForbiddenException('Invalid token or api key');
  }

  @Get('user/:userId')
  findByUser(@Param('userId') userId: string) {
    return this.agentsService.findByUser(userId);
  }

  @Get('my')
  @UseGuards(AuthGuard)
  async findMyAgent(@Req() req: RequestWithUser) {
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User ID not found in token');
    }
    const agents = await this.agentsService.findByUser(userId);
    // 返回用户的第一个 Agent，如果没有则返回 null
    return agents && agents.length > 0 ? agents[0] : null;
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.agentsService.findOne(id);
  }

  @Get(':id/webhook-deliveries')
  listWebhookDeliveries(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.agentsService.listWebhookDeliveries(id);
  }

  @Post(':id/skills')
  async updateSkills(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateSkillsBody,
  ) {
    if (!Array.isArray(body.skills)) {
      throw new BadRequestException('skills must be an array of strings');
    }
    const skills = body.skills.filter((s) => typeof s === 'string');
    return this.agentsService.updateSkills(id, skills);
  }

  @Post(':id/webhook-url')
  async updateWebhookUrl(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: { webhookUrl: string },
  ) {
    if (typeof body.webhookUrl !== 'string') {
      throw new BadRequestException('webhookUrl must be a string');
    }
    return this.agentsService.updateWebhookUrl(id, body.webhookUrl);
  }

  @Get(':id/api-keys')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async listApiKeys(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ) {
    const agent = await this.agentsService.findOneWithOwner(id);
    if (!agent) {
      throw new BadRequestException('Agent not found');
    }
    if (req.user?.role !== UserRole.ADMIN && agent.owner?.id !== req.user?.id) {
      throw new ForbiddenException('Only the agent owner can manage api keys');
    }
    const keys = await this.agentsService.listApiKeys(id);
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      createdAt: k.createdAt,
      revokedAt: k.revokedAt,
      lastUsedAt: k.lastUsedAt,
    }));
  }

  @Post(':id/api-keys')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async createApiKey(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CreateApiKeyBody,
    @Req() req: RequestWithUser,
  ) {
    const agent = await this.agentsService.findOneWithOwner(id);
    if (!agent) {
      throw new BadRequestException('Agent not found');
    }
    if (req.user?.role !== UserRole.ADMIN && agent.owner?.id !== req.user?.id) {
      throw new ForbiddenException('Only the agent owner can manage api keys');
    }
    const name = typeof body.name === 'string' ? body.name : undefined;
    return this.agentsService.createApiKey({ agentId: id, name });
  }

  @Post(':id/api-keys/:keyId/revoke')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async revokeApiKey(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('keyId', new ParseUUIDPipe({ version: '4' })) keyId: string,
    @Req() req: RequestWithUser,
  ) {
    const agent = await this.agentsService.findOneWithOwner(id);
    if (!agent) {
      throw new BadRequestException('Agent not found');
    }
    if (req.user?.role !== UserRole.ADMIN && agent.owner?.id !== req.user?.id) {
      throw new ForbiddenException('Only the agent owner can manage api keys');
    }
    return this.agentsService.revokeApiKey({ agentId: id, keyId });
  }

  /**
   * 临时接口：无需权限创建 API key（仅用于初始化）
   */
  @Post(':id/api-keys/init')
  async createApiKeyInit(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CreateApiKeyBody,
  ) {
    const agent = await this.agentsService.findOneWithOwner(id);
    if (!agent) {
      throw new BadRequestException('Agent not found');
    }
    const name =
      typeof body.name === 'string' ? body.name : 'Auto-generated Key';
    return this.agentsService.createApiKey({ agentId: id, name });
  }

  /**
   * Agent 心跳接口
   */
  @Post(':id/heartbeat')
  async heartbeat(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.agentsService.heartbeat(id);
  }

  /**
   * Agent 心跳失败报告接口
   */
  @Post(':id/heartbeat-failed')
  async heartbeatFailed(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.agentsService.heartbeatFailed(id);
  }

  /**
   * 获取 Agent 在线状态
   */
  @Get(':id/status')
  async getStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.agentsService.getStatus(id);
  }

  /**
   * 更新 Agent 收款码（开发者设置自己的收款信息）
   */
  @Post(':id/payment')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async updatePayment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdatePaymentBody,
    @Req() req: RequestWithUser,
  ) {
    const agent = await this.agentsService.findOneWithOwner(id);
    if (!agent) {
      throw new BadRequestException('Agent not found');
    }
    if (req.user?.role !== UserRole.ADMIN && agent.owner?.id !== req.user?.id) {
      throw new ForbiddenException(
        'Only the agent owner can update payment info',
      );
    }
    return this.agentsService.updatePayment(id, {
      paymentQrUrl: body.paymentQrUrl,
      paymentQrType: body.paymentQrType,
      paymentAccount: body.paymentAccount,
    });
  }

  /**
   * 获取 Agent 收款信息（管理员查看）
   */
  @Get(':id/payment')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getPayment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const agent = await this.agentsService.findOne(id);
    if (!agent) {
      throw new BadRequestException('Agent not found');
    }
    return {
      paymentQrUrl: agent.paymentQrUrl,
      paymentQrType: agent.paymentQrType,
      paymentAccount: agent.paymentAccount,
    };
  }

  /**
   * 执行 Agent 健康检查（探测 Openclaw 关联状态）
   */
  @Post(':id/health-check')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async healthCheck(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ) {
    const agent = await this.agentsService.findOneWithOwner(id);
    if (!agent) {
      throw new BadRequestException('Agent not found');
    }
    if (req.user?.role !== UserRole.ADMIN && agent.owner?.id !== req.user?.id) {
      throw new ForbiddenException(
        'Only the agent owner can perform health check',
      );
    }
    return this.agentsService.healthCheck(id);
  }

  /**
   * 获取 Agent 健康状态
   */
  @Get(':id/health')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async getHealthStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ) {
    const agent = await this.agentsService.findOneWithOwner(id);
    if (!agent) {
      throw new BadRequestException('Agent not found');
    }
    if (req.user?.role !== UserRole.ADMIN && agent.owner?.id !== req.user?.id) {
      throw new ForbiddenException(
        'Only the agent owner can view health status',
      );
    }
    return this.agentsService.getHealthStatus(id);
  }

  /**
   * 更新 Openclaw URL
   */
  @Post(':id/openclaw-url')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async updateOpenclawUrl(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: { openclawUrl: string },
    @Req() req: RequestWithUser,
  ) {
    const agent = await this.agentsService.findOneWithOwner(id);
    if (!agent) {
      throw new BadRequestException('Agent not found');
    }
    if (req.user?.role !== UserRole.ADMIN && agent.owner?.id !== req.user?.id) {
      throw new ForbiddenException(
        'Only the agent owner can update openclaw url',
      );
    }
    if (typeof body.openclawUrl !== 'string') {
      throw new BadRequestException('openclawUrl must be a string');
    }
    return this.agentsService.updateOpenclawUrl(id, body.openclawUrl);
  }

  /**
   * 更新 Agent ID（管理员接口，用于同步 K8s Pod 标签）
   */
  @Post(':id/update-agent-id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async updateAgentId(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: { newId: string },
  ) {
    if (
      typeof body.newId !== 'string' ||
      !body.newId.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )
    ) {
      throw new BadRequestException('newId must be a valid UUID');
    }
    return this.agentsService.updateAgentId(id, body.newId);
  }
}
