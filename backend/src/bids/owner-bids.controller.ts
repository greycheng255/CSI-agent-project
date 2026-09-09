import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { RequestWithUser } from '../auth/auth.guard';
import { BidsService } from './bids.service';

type OwnerCreateBidBody = {
  taskId?: unknown;
  agentId?: unknown;
  priceCny?: unknown;
  planSummary?: unknown;
  pricingModel?: unknown;
  pricingMeta?: unknown;
  estimatedHours?: unknown;
  riskNotes?: unknown;
};

/**
 * Owner 手动报价（任务大厅）：agent owner 登录态下，选择 open 任务 + 名下 agent，
 * 立即让该 agent 参与报价（不等自动轮询/派单窗口）。归属在 BidsService.createByOwner 校验。
 */
@Controller('api/v1/owner/bids')
@UseGuards(AuthGuard)
export class OwnerBidsController {
  constructor(private readonly bidsService: BidsService) {}

  @Post()
  create(@Body() body: OwnerCreateBidBody, @Req() req: RequestWithUser) {
    const ownerId = req.user?.id;
    if (!ownerId) {
      throw new BadRequestException('owner is required');
    }
    const taskId = body.taskId;
    if (typeof taskId !== 'string' || taskId.trim().length === 0) {
      throw new BadRequestException('taskId is required');
    }
    const agentId = body.agentId;
    if (typeof agentId !== 'string' || agentId.trim().length === 0) {
      throw new BadRequestException('agentId is required');
    }
    const priceCny =
      typeof body.priceCny === 'number' ? body.priceCny : Number(body.priceCny);
    if (!Number.isFinite(priceCny) || !Number.isInteger(priceCny)) {
      throw new BadRequestException('priceCny must be an integer');
    }
    const planSummary =
      typeof body.planSummary === 'string' ? body.planSummary : undefined;
    const pricingModel =
      typeof body.pricingModel === 'string' ? body.pricingModel : undefined;
    const pricingMeta =
      body.pricingMeta &&
      typeof body.pricingMeta === 'object' &&
      !Array.isArray(body.pricingMeta)
        ? (body.pricingMeta as Record<string, unknown>)
        : undefined;
    const estimatedHours =
      body.estimatedHours === undefined || body.estimatedHours === null
        ? undefined
        : Number(body.estimatedHours);
    const riskNotes =
      typeof body.riskNotes === 'string' ? body.riskNotes : undefined;

    return this.bidsService.createByOwner(ownerId, {
      taskId,
      agentId,
      priceCny,
      planSummary,
      pricingModel,
      pricingMeta,
      estimatedHours,
      riskNotes,
    });
  }
}
