import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import type { RequestWithUser } from '../../auth/auth.guard';
import { MarketplaceBidsService } from './marketplace-bids.service';

type OwnerMarketplaceBidBody = {
  taskId?: unknown;
  workspaceId?: unknown;
  priceCny?: unknown;
  planSummary?: unknown;
  estimatedDeliveryAt?: unknown;
};

/**
 * Owner 手动报价（长任务线，平台前端用）：workspace owner 登录态下，选择 open 任务 +
 * 自己名下的 workspace，立即占席位报价（source=manual_assign，不等 Console 5min pull）。
 * workspace 归属在 MarketplaceBidsService.submitByOwner 校验。
 */
@Controller('api/v1/longtask/owner/bids')
@UseGuards(AuthGuard)
export class OwnerMarketplaceBidsController {
  constructor(private readonly bidsService: MarketplaceBidsService) {}

  @Post()
  create(@Body() body: OwnerMarketplaceBidBody, @Req() req: RequestWithUser) {
    const ownerId = req.user?.id;
    if (!ownerId) {
      throw new BadRequestException('owner is required');
    }
    const taskId = body.taskId;
    if (typeof taskId !== 'string' || taskId.trim().length === 0) {
      throw new BadRequestException('taskId is required');
    }
    const workspaceId = body.workspaceId;
    if (typeof workspaceId !== 'string' || workspaceId.trim().length === 0) {
      throw new BadRequestException('workspaceId is required');
    }
    const priceCny =
      typeof body.priceCny === 'number' ? body.priceCny : Number(body.priceCny);
    if (!Number.isFinite(priceCny) || !Number.isInteger(priceCny) || priceCny <= 0) {
      throw new BadRequestException('priceCny must be a positive integer');
    }
    const planSummary =
      typeof body.planSummary === 'string' ? body.planSummary : null;
    const estimatedDeliveryAtRaw = body.estimatedDeliveryAt;
    let estimatedDeliveryAt: Date | string | null = null;
    if (typeof estimatedDeliveryAtRaw === 'string') {
      const parsed = new Date(estimatedDeliveryAtRaw);
      if (!isNaN(parsed.getTime())) {
        estimatedDeliveryAt = parsed;
      }
    } else if (estimatedDeliveryAtRaw instanceof Date) {
      estimatedDeliveryAt = estimatedDeliveryAtRaw;
    }

    return this.bidsService.submitByOwner({
      taskId,
      workspaceId,
      ownerId,
      priceCny,
      planSummary,
      estimatedDeliveryAt,
    });
  }
}
