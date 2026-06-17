import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  UseGuards,
  Req,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { AdminPermissionGuard } from '../admin/admin.guard';
import { RequirePermission } from '../admin/admin-permission.decorator';
import { ADMIN_PERMISSIONS } from '../admin/admin-permissions';
import { AgentManagerService } from './agent-manager.service';
import { AgentsService } from './agents.service';
import type { RequestWithUser } from '../auth/auth.guard';

@Controller('api/v1/agent-manager')
@UseGuards(AuthGuard)
export class AgentManagerController {
  private readonly logger = new Logger(AgentManagerController.name);

  constructor(
    private readonly agentManagerService: AgentManagerService,
    private readonly agentsService: AgentsService,
  ) {}

  /**
   * 为用户自动创建 Agent（如果还没有）
   */
  @Post('ensure')
  async ensureAgent(@Req() req: RequestWithUser) {
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    // 获取用户的 owner token
    const user = await this.agentsService['usersRepository'].findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new ForbiddenException('User not found');
    }

    // 这里需要实现获取 owner token 的逻辑
    // 暂时使用一个默认的 token 生成策略
    const ownerToken = this.generateOwnerToken(userId);

    this.logger.log(`Ensuring agent for user ${userId}`);

    const agent = await this.agentManagerService.createAgentForUser(
      user,
      ownerToken,
    );

    return {
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        externalId: agent.externalId,
        webhookUrl: agent.webhookUrl,
      },
      message: 'Agent created or already exists',
    };
  }

  /**
   * 销毁用户的 Agent
   */
  @Delete('my-agent')
  async destroyMyAgent(@Req() req: RequestWithUser) {
    const userId = req.user?.id;
    const userPhone = req.user?.phone;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    this.logger.log(`Destroying agent for user ${userId}, phone: ${userPhone}`);

    await this.agentManagerService.destroyAgentForUser(userId, userPhone);

    return {
      success: true,
      message: 'Agent destroyed successfully',
    };
  }

  /**
   * 获取我的 Agent 状态
   */
  @Get('my-agent/status')
  async getMyAgentStatus(
    @Req() req: RequestWithUser,
  ): Promise<{ success: boolean; status: any }> {
    const userId = req.user?.id;
    const userPhone = req.user?.phone;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    const status = await this.agentManagerService.getAgentStatus(
      userId,
      userPhone,
    );

    return {
      success: true,
      status,
    };
  }

  /**
   * 重启我的 Agent
   */
  @Post('my-agent/restart')
  async restartMyAgent(@Req() req: RequestWithUser) {
    const userId = req.user?.id;
    const userPhone = req.user?.phone;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    this.logger.log(`Restarting agent for user ${userId}, phone: ${userPhone}`);

    await this.agentManagerService.restartAgent(userId, userPhone);

    return {
      success: true,
      message: 'Agent restarted successfully',
    };
  }

  /**
   * 管理员：列出所有 Agent Pod
   */
  @Get('admin/pods')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(ADMIN_PERMISSIONS.AGENT_VIEW)
  async listAllPods() {
    const pods = await this.agentManagerService.listAllAgentPods();

    return {
      success: true,
      pods,
      total: pods.length,
    };
  }

  /**
   * 管理员：为用户创建 Agent
   */
  @Post('admin/create-for/:userId')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(ADMIN_PERMISSIONS.AGENT_MANAGE)
  async createAgentForUser(
    @Param('userId') targetUserId: string,
    @Req() _req: RequestWithUser, // eslint-disable-line @typescript-eslint/no-unused-vars
  ) {
    const user = await this.agentsService['usersRepository'].findOne({
      where: { id: targetUserId },
    });

    if (!user) {
      throw new ForbiddenException('Target user not found');
    }

    const ownerToken = this.generateOwnerToken(targetUserId);

    this.logger.log(`Admin creating agent for user ${targetUserId}`);

    const agent = await this.agentManagerService.createAgentForUser(
      user,
      ownerToken,
    );

    return {
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        externalId: agent.externalId,
      },
    };
  }

  /**
   * 生成 Owner Token
   * 实际项目中应该从 auth service 获取
   */
  private generateOwnerToken(userId: string): string {
    // 这里简化处理，实际应该使用 JWT 或其他方式
    return `owner-token-${userId}-${Date.now()}`;
  }
}
