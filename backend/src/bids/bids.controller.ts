import {
  Controller,
  Post,
  Put,
  Body,
  Get,
  Param,
  ParseUUIDPipe,
  BadRequestException,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { BidsService } from './bids.service';
import { AgentsService } from '../agents/agents.service';

type CreateBidBody = {
  taskId?: unknown;
  agentId?: unknown;
  agentName?: unknown;
  priceCny?: unknown;
  planSummary?: unknown;
  pricingModel?: unknown;
  pricingMeta?: unknown;
  expiresAt?: unknown;
  confidenceScore?: unknown;
  estimatedHours?: unknown;
  riskNotes?: unknown;
};

@Controller('api/v1/agent/bids')
export class BidsController {
  constructor(
    private readonly bidsService: BidsService,
    private readonly agentsService: AgentsService,
  ) {}

  @Post()
  async create(
    @Body() body: CreateBidBody,
    @Headers('authorization') authorization?: string,
  ) {
    const taskId = body.taskId;
    if (typeof taskId !== 'string' || taskId.trim().length === 0) {
      throw new BadRequestException('taskId is required');
    }
    await new ParseUUIDPipe({ version: '4' }).transform(taskId, {
      type: 'body',
      metatype: String,
      data: 'taskId',
    });

    let agentIdFromKey: string | undefined;
    if (
      typeof authorization === 'string' &&
      authorization.startsWith('Bearer ')
    ) {
      const token = authorization.slice('Bearer '.length).trim();
      if (!token)
        throw new UnauthorizedException('Invalid Authorization header');
      const agent = await this.agentsService.validateAgentApiKey(token);
      if (!agent) throw new UnauthorizedException('Invalid agent api key');
      agentIdFromKey = agent.id;
    }

    const agentIdRaw = body.agentId;
    let agentId: string | undefined;
    if (agentIdRaw !== undefined && agentIdRaw !== null) {
      if (typeof agentIdRaw !== 'string' || agentIdRaw.trim().length === 0) {
        throw new BadRequestException('agentId must be a UUID string');
      }
      await new ParseUUIDPipe({ version: '4' }).transform(agentIdRaw, {
        type: 'body',
        metatype: String,
        data: 'agentId',
      });
      agentId = agentIdRaw;
    }

    if (agentIdFromKey) {
      if (agentId && agentId !== agentIdFromKey) {
        throw new BadRequestException('agentId does not match api key');
      }
      agentId = agentIdFromKey;
    }

    const priceCnyRaw = body.priceCny;
    const priceCny =
      typeof priceCnyRaw === 'number' ? priceCnyRaw : Number(priceCnyRaw);
    if (!Number.isFinite(priceCny) || !Number.isInteger(priceCny)) {
      throw new BadRequestException('priceCny must be an integer');
    }

    const planSummaryRaw = body.planSummary;
    const planSummary =
      typeof planSummaryRaw === 'string' ? planSummaryRaw : undefined;

    const agentNameRaw = body.agentName;
    const agentName =
      typeof agentNameRaw === 'string' ? agentNameRaw : undefined;

    const pricingModelRaw = body.pricingModel;
    const pricingModel =
      typeof pricingModelRaw === 'string' ? pricingModelRaw : undefined;

    const pricingMetaRaw = body.pricingMeta;
    const pricingMeta =
      pricingMetaRaw &&
      typeof pricingMetaRaw === 'object' &&
      !Array.isArray(pricingMetaRaw)
        ? (pricingMetaRaw as Record<string, unknown>)
        : undefined;

    const expiresAtRaw = body.expiresAt;
    let expiresAt: Date | undefined;
    if (expiresAtRaw !== undefined && expiresAtRaw !== null) {
      if (typeof expiresAtRaw === 'string') {
        const parsed = new Date(expiresAtRaw);
        if (!isNaN(parsed.getTime())) {
          expiresAt = parsed;
        }
      } else if (expiresAtRaw instanceof Date) {
        expiresAt = expiresAtRaw;
      }
    }

    const confidenceScoreRaw = body.confidenceScore;
    const confidenceScore =
      confidenceScoreRaw === undefined || confidenceScoreRaw === null
        ? undefined
        : Number(confidenceScoreRaw);
    if (confidenceScore !== undefined && !Number.isFinite(confidenceScore)) {
      throw new BadRequestException('confidenceScore must be a number');
    }

    const estimatedHoursRaw = body.estimatedHours;
    const estimatedHours =
      estimatedHoursRaw === undefined || estimatedHoursRaw === null
        ? undefined
        : Number(estimatedHoursRaw);
    if (
      estimatedHours !== undefined &&
      (!Number.isFinite(estimatedHours) || !Number.isInteger(estimatedHours))
    ) {
      throw new BadRequestException('estimatedHours must be an integer');
    }

    const riskNotes =
      typeof body.riskNotes === 'string' ? body.riskNotes : undefined;

    return this.bidsService.create({
      taskId,
      agentId,
      priceCny,
      planSummary,
      agentName,
      pricingModel,
      pricingMeta,
      expiresAt,
      confidenceScore,
      estimatedHours,
      riskNotes,
    });
  }

  // 虽然路径是 /api/v1/agent/bids，但这里临时提供一个按 taskId 查询的接口供前端展示用
  @Get('task/:taskId')
  findByTask(
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
  ) {
    return this.bidsService.findByTask(taskId);
  }

  @Get('agent/:agentId')
  findByAgent(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
  ) {
    return this.bidsService.findByAgent(agentId);
  }

  // 更新报价接口 - 允许 Agent 更新自己的报价
  @Put(':bidId')
  async update(
    @Param('bidId', new ParseUUIDPipe({ version: '4' })) bidId: string,
    @Body() body: CreateBidBody,
    @Headers('authorization') authorization?: string,
  ) {
    // 验证 API Key
    let agentIdFromKey: string | undefined;
    if (
      typeof authorization === 'string' &&
      authorization.startsWith('Bearer ')
    ) {
      const token = authorization.slice('Bearer '.length).trim();
      if (!token)
        throw new UnauthorizedException('Invalid Authorization header');
      const agent = await this.agentsService.validateAgentApiKey(token);
      if (!agent) throw new UnauthorizedException('Invalid agent api key');
      agentIdFromKey = agent.id;
    }

    if (!agentIdFromKey) {
      throw new UnauthorizedException('Agent API key required');
    }

    const priceCnyRaw = body.priceCny;
    const priceCny =
      typeof priceCnyRaw === 'number' ? priceCnyRaw : Number(priceCnyRaw);
    if (!Number.isFinite(priceCny) || !Number.isInteger(priceCny)) {
      throw new BadRequestException('priceCny must be an integer');
    }

    const planSummaryRaw = body.planSummary;
    const planSummary =
      typeof planSummaryRaw === 'string' ? planSummaryRaw : undefined;

    const pricingModelRaw = body.pricingModel;
    const pricingModel =
      typeof pricingModelRaw === 'string' ? pricingModelRaw : undefined;

    const pricingMetaRaw = body.pricingMeta;
    const pricingMeta =
      pricingMetaRaw &&
      typeof pricingMetaRaw === 'object' &&
      !Array.isArray(pricingMetaRaw)
        ? (pricingMetaRaw as Record<string, unknown>)
        : undefined;

    const expiresAtRaw = body.expiresAt;
    let expiresAt: Date | undefined;
    if (expiresAtRaw !== undefined && expiresAtRaw !== null) {
      if (typeof expiresAtRaw === 'string') {
        const parsed = new Date(expiresAtRaw);
        if (!isNaN(parsed.getTime())) {
          expiresAt = parsed;
        }
      } else if (expiresAtRaw instanceof Date) {
        expiresAt = expiresAtRaw;
      }
    }

    const confidenceScoreRaw = body.confidenceScore;
    const confidenceScore =
      confidenceScoreRaw === undefined || confidenceScoreRaw === null
        ? undefined
        : Number(confidenceScoreRaw);
    if (confidenceScore !== undefined && !Number.isFinite(confidenceScore)) {
      throw new BadRequestException('confidenceScore must be a number');
    }

    const estimatedHoursRaw = body.estimatedHours;
    const estimatedHours =
      estimatedHoursRaw === undefined || estimatedHoursRaw === null
        ? undefined
        : Number(estimatedHoursRaw);
    if (
      estimatedHours !== undefined &&
      (!Number.isFinite(estimatedHours) || !Number.isInteger(estimatedHours))
    ) {
      throw new BadRequestException('estimatedHours must be an integer');
    }

    const riskNotes =
      typeof body.riskNotes === 'string' ? body.riskNotes : undefined;

    return this.bidsService.update(bidId, agentIdFromKey, {
      priceCny,
      planSummary,
      pricingModel,
      pricingMeta,
      expiresAt,
      confidenceScore,
      estimatedHours,
      riskNotes,
    });
  }

  // 根据 taskId 和 agentId 更新报价（用于 Agent 重新报价）
  @Post(':bidId/withdraw')
  async withdraw(
    @Param('bidId', new ParseUUIDPipe({ version: '4' })) bidId: string,
    @Headers('authorization') authorization?: string,
  ) {
    let agentIdFromKey: string | undefined;
    if (
      typeof authorization === 'string' &&
      authorization.startsWith('Bearer ')
    ) {
      const token = authorization.slice('Bearer '.length).trim();
      if (!token)
        throw new UnauthorizedException('Invalid Authorization header');
      const agent = await this.agentsService.validateAgentApiKey(token);
      if (!agent) throw new UnauthorizedException('Invalid agent api key');
      agentIdFromKey = agent.id;
    }
    if (!agentIdFromKey) {
      throw new UnauthorizedException('Agent API key required');
    }
    return this.bidsService.withdraw(bidId, agentIdFromKey);
  }

  @Put('task/:taskId')
  async updateByTask(
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @Body() body: CreateBidBody,
    @Headers('authorization') authorization?: string,
  ) {
    // 验证 API Key
    let agentIdFromKey: string | undefined;
    if (
      typeof authorization === 'string' &&
      authorization.startsWith('Bearer ')
    ) {
      const token = authorization.slice('Bearer '.length).trim();
      if (!token)
        throw new UnauthorizedException('Invalid Authorization header');
      const agent = await this.agentsService.validateAgentApiKey(token);
      if (!agent) throw new UnauthorizedException('Invalid agent api key');
      agentIdFromKey = agent.id;
    }

    if (!agentIdFromKey) {
      throw new UnauthorizedException('Agent API key required');
    }

    const priceCnyRaw = body.priceCny;
    const priceCny =
      typeof priceCnyRaw === 'number' ? priceCnyRaw : Number(priceCnyRaw);
    if (!Number.isFinite(priceCny) || !Number.isInteger(priceCny)) {
      throw new BadRequestException('priceCny must be an integer');
    }

    const planSummaryRaw = body.planSummary;
    const planSummary =
      typeof planSummaryRaw === 'string' ? planSummaryRaw : undefined;

    const pricingModelRaw = body.pricingModel;
    const pricingModel =
      typeof pricingModelRaw === 'string' ? pricingModelRaw : undefined;

    const pricingMetaRaw = body.pricingMeta;
    const pricingMeta =
      pricingMetaRaw &&
      typeof pricingMetaRaw === 'object' &&
      !Array.isArray(pricingMetaRaw)
        ? (pricingMetaRaw as Record<string, unknown>)
        : undefined;

    const expiresAtRaw = body.expiresAt;
    let expiresAt: Date | undefined;
    if (expiresAtRaw !== undefined && expiresAtRaw !== null) {
      if (typeof expiresAtRaw === 'string') {
        const parsed = new Date(expiresAtRaw);
        if (!isNaN(parsed.getTime())) {
          expiresAt = parsed;
        }
      } else if (expiresAtRaw instanceof Date) {
        expiresAt = expiresAtRaw;
      }
    }

    const confidenceScoreRaw = body.confidenceScore;
    const confidenceScore =
      confidenceScoreRaw === undefined || confidenceScoreRaw === null
        ? undefined
        : Number(confidenceScoreRaw);
    if (confidenceScore !== undefined && !Number.isFinite(confidenceScore)) {
      throw new BadRequestException('confidenceScore must be a number');
    }

    const estimatedHoursRaw = body.estimatedHours;
    const estimatedHours =
      estimatedHoursRaw === undefined || estimatedHoursRaw === null
        ? undefined
        : Number(estimatedHoursRaw);
    if (
      estimatedHours !== undefined &&
      (!Number.isFinite(estimatedHours) || !Number.isInteger(estimatedHours))
    ) {
      throw new BadRequestException('estimatedHours must be an integer');
    }

    const riskNotes =
      typeof body.riskNotes === 'string' ? body.riskNotes : undefined;

    return this.bidsService.updateByTask(taskId, agentIdFromKey, {
      priceCny,
      planSummary,
      pricingModel,
      pricingMeta,
      expiresAt,
      confidenceScore,
      estimatedHours,
      riskNotes,
    });
  }
}
