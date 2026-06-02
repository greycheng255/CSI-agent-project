import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Headers,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent, AgentStatus, OpenclawStatus } from './entities/agent.entity';
import { User } from '../users/entities/user.entity';
import { randomBytes } from 'crypto';

// 绑定请求 DTO
class BindAgentDto {
  agentId: string;
  externalId: string;
  openclawUrl: string;
  openclawInstance: string;
  signature: string;
  timestamp: number;
}

// 生成绑定令牌响应
class BindTokenResponse {
  token: string;
  expiresAt: Date;
  bindUrl: string;
}

@Controller('api/v1/agent-bind')
export class AgentBindController {
  private readonly logger = new Logger(AgentBindController.name);

  // 临时存储绑定令牌 (生产环境应该使用 Redis)
  private bindTokens: Map<
    string,
    { userId: string; agentId: string; expiresAt: Date }
  > = new Map();

  constructor(
    @InjectRepository(Agent)
    private readonly agentsRepository: Repository<Agent>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  /**
   * 生成绑定令牌
   * 用户在 Web 界面点击"绑定 Openclaw"时调用
   */
  @Post('generate-token')
  async generateBindToken(
    @Headers('authorization') auth: string,
    @Body() body: { agentId?: string },
  ): Promise<{ success: boolean; data?: BindTokenResponse; message?: string }> {
    // 验证用户身份
    const userId = await this.verifyAuth(auth);
    if (!userId) {
      throw new UnauthorizedException('Invalid token');
    }

    // 查找用户的 Agent
    let agent: Agent | null = null;
    if (body.agentId) {
      agent = await this.agentsRepository.findOne({
        where: { id: body.agentId, owner: { id: userId } },
      });
    } else {
      // 如果没有指定 agentId，使用用户的第一个 Agent
      const agents = await this.agentsRepository.find({
        where: { owner: { id: userId }, isActive: true },
        order: { createdAt: 'DESC' },
      });
      agent = agents[0] || null;
    }

    if (!agent) {
      throw new BadRequestException('Agent not found');
    }

    // 生成绑定令牌
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10分钟有效期

    this.bindTokens.set(token, {
      userId,
      agentId: agent.id,
      expiresAt,
    });

    this.logger.log(
      `Generated bind token for agent ${agent.id}, user ${userId}`,
    );

    return {
      success: true,
      data: {
        token,
        expiresAt,
        bindUrl: `/api/v1/agent-bind/execute`,
      },
    };
  }

  /**
   * 执行绑定
   * 在 Openclaw 实例中执行命令时调用
   */
  @Post('execute')
  async executeBind(
    @Body() data: BindAgentDto,
  ): Promise<{ success: boolean; message: string; agent?: any }> {
    // 验证令牌
    const tokenData = this.bindTokens.get(data.signature);
    if (!tokenData) {
      throw new UnauthorizedException('Invalid or expired bind token');
    }

    if (new Date() > tokenData.expiresAt) {
      this.bindTokens.delete(data.signature);
      throw new UnauthorizedException('Bind token expired');
    }

    // 验证时间戳 (防止重放攻击)
    const now = Date.now();
    if (Math.abs(now - data.timestamp) > 5 * 60 * 1000) {
      throw new BadRequestException('Invalid timestamp');
    }

    // 查找 Agent
    const agent = await this.agentsRepository.findOne({
      where: { id: tokenData.agentId },
      relations: ['owner'],
    });

    if (!agent) {
      throw new BadRequestException('Agent not found');
    }

    // 更新 Agent 的 Openclaw 绑定信息
    agent.openclawUrl = data.openclawUrl;
    agent.openclawStatus = OpenclawStatus.CONNECTED;
    agent.externalId = data.externalId;
    agent.agentMode = 'external'; // 标记为外部模式
    agent.status = AgentStatus.ONLINE;

    await this.agentsRepository.save(agent);

    // 清除已使用的令牌
    this.bindTokens.delete(data.signature);

    this.logger.log(
      `Agent ${agent.id} bound to Openclaw at ${data.openclawUrl}`,
    );

    return {
      success: true,
      message: 'Agent bound successfully',
      agent: {
        id: agent.id,
        name: agent.name,
        openclawUrl: agent.openclawUrl,
        openclawStatus: agent.openclawStatus,
      },
    };
  }

  /**
   * 获取绑定状态
   */
  @Get('status/:agentId')
  async getBindStatus(
    @Headers('authorization') auth: string,
    @Param('agentId') agentId: string,
  ): Promise<{ success: boolean; data?: any; message?: string }> {
    const userId = await this.verifyAuth(auth);
    if (!userId) {
      throw new UnauthorizedException('Invalid token');
    }

    const agent = await this.agentsRepository.findOne({
      where: { id: agentId, owner: { id: userId } },
    });

    if (!agent) {
      throw new BadRequestException('Agent not found');
    }

    return {
      success: true,
      data: {
        agentId: agent.id,
        openclawUrl: agent.openclawUrl,
        openclawStatus: agent.openclawStatus,
        isBound:
          !!agent.openclawUrl &&
          agent.openclawStatus === OpenclawStatus.CONNECTED,
      },
    };
  }

  /**
   * 解绑 Openclaw
   */
  @Post('unbind/:agentId')
  async unbindOpenclaw(
    @Headers('authorization') auth: string,
    @Param('agentId') agentId: string,
  ): Promise<{ success: boolean; message: string }> {
    const userId = await this.verifyAuth(auth);
    if (!userId) {
      throw new UnauthorizedException('Invalid token');
    }

    const agent = await this.agentsRepository.findOne({
      where: { id: agentId, owner: { id: userId } },
    });

    if (!agent) {
      throw new BadRequestException('Agent not found');
    }

    agent.openclawUrl = null;
    agent.openclawStatus = OpenclawStatus.DISCONNECTED;
    await this.agentsRepository.save(agent);

    this.logger.log(`Agent ${agent.id} unbound from Openclaw`);

    return {
      success: true,
      message: 'Agent unbound successfully',
    };
  }

  /**
   * 简单的 token 验证 (实际应该使用 AuthGuard)
   */
  private async verifyAuth(auth: string): Promise<string | null> {
    if (!auth || !auth.startsWith('Bearer ')) {
      return null;
    }

    // 这里简化处理，实际应该验证 JWT
    // 临时方案：从 token 解析用户 ID
    try {
      // 假设 token 格式包含用户 ID
      // 实际应该使用 JWT 验证
      const users = await this.usersRepository.find();
      // 返回第一个用户作为演示 (实际应该正确解析 token)
      return users[0]?.id || null;
    } catch {
      return null;
    }
  }
}
