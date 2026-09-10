import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { HmacGuard } from '../contract/hmac.guard';
import { DisputesService } from '../disputes/disputes.service';
import { SettlementsService } from '../settlements/settlements.service';
import {
  DISPUTE_RESOLUTION,
  DisputeResolution,
  ZERO_SETTLEMENT_RESOLUTIONS,
} from '../disputes/dispute.entity';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';

/**
 * 平台运营/结算版块通道（服务级 HMAC，与 Console 契约同鉴权口径）。
 * 承载 M→C 事件的「M 侧触发源」，这些动作不来自 Console 而是平台内部：
 *  - POST /v1/marketplace/ops/disputes/:disputeId/arbitration-start    场景十 #41 受理并启动仲裁
 *  - POST /v1/marketplace/ops/disputes/:disputeId/arbitration-result   场景十 #42 仲裁裁定（六值）
 *  - POST /v1/marketplace/ops/orders/:orderId/settlement-completed     场景九 #32 结算支付版块回执
 */
@Controller('v1/marketplace/ops')
@UseGuards(HmacGuard)
export class MarketplaceOpsController {
  constructor(
    private readonly disputesService: DisputesService,
    private readonly settlementsService: SettlementsService,
  ) {}

  @Post('disputes/:disputeId/arbitration-start')
  startArbitration(@Param('disputeId') disputeId: string) {
    return this.disputesService.startArbitration(disputeId);
  }

  @Post('disputes/:disputeId/arbitration-result')
  arbitrationResult(
    @Param('disputeId') disputeId: string,
    @Body() body: { resolution?: unknown; amount_cny?: unknown },
  ) {
    const resolution = body.resolution;
    if (
      typeof resolution !== 'string' ||
      !DISPUTE_RESOLUTION.includes(resolution as DisputeResolution)
    ) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        `resolution must be one of ${DISPUTE_RESOLUTION.join('/')}`,
      );
    }
    const typed = resolution as DisputeResolution;
    const amountCny =
      typeof body.amount_cny === 'number' ? body.amount_cny : null;
    // 零结算出口不带金额；出钱出口必须带金额（供结算台账落账）
    if (ZERO_SETTLEMENT_RESOLUTIONS.includes(typed) && amountCny !== null) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        `resolution=${typed} must not carry amount_cny`,
      );
    }
    return this.disputesService.resolve(disputeId, typed, amountCny);
  }

  @Post('orders/:orderId/settlement-completed')
  settlementCompleted(@Param('orderId') orderId: string) {
    return this.settlementsService.consumeSettlementCompleted(orderId);
  }
}
