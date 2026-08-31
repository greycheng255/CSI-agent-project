import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { MarketplaceSettlement } from './settlement.entity';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import {
  Milestone,
  isWeightsSumValid,
  settlementAmount,
} from './milestone-math';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';
import { CONSOLE_WEBHOOK, consoleWebhookUrl } from '../contract/console-endpoints';

/**
 * 结算数据面（T20/T21，D3）：结算单 + 里程碑公式 + 对账 #35/#36。
 * 平台不执行划款：settlement/trigger 后把结算数据交关联方，
 * 收到关联方 settlement.completed 回写后更新状态。
 */
@Injectable()
export class SettlementsService {
  constructor(
    @InjectRepository(MarketplaceSettlement)
    private readonly settleRepo: Repository<MarketplaceSettlement>,
    @InjectRepository(MarketplaceOrder)
    private readonly ordersRepo: Repository<MarketplaceOrder>,
    private readonly dispatcher: WebhookDispatcherService,
  ) {}

  /** C→M #31：触发结算（校验权重和=100% → 备结算单数据；幂等 UNIQUE(order_id)） */
  async trigger(orderId: string): Promise<MarketplaceSettlement> {
    const order = await this.getOrThrowOrder(orderId);

    const existing = await this.settleRepo.findOne({ where: { orderId } });
    if (existing) {
      throw new ContractError(
        409,
        CONTRACT_ERROR_CODE.CONFLICT_SETTLEMENT_ALREADY_TRIGGERED,
        `settlement already triggered for order ${orderId}`,
      );
    }

    const milestones = Array.isArray(order.milestones)
      ? (order.milestones as Milestone[])
      : [];
    if (!isWeightsSumValid(milestones)) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        'milestone weights must sum to 100%',
      );
    }
    const finalPrice = order.finalPriceCny ?? 0;
    const amount = settlementAmount(milestones, finalPrice);

    const settlement = this.settleRepo.create({
      orderId,
      workspaceId: order.workspaceId,
      amountCny: amount,
      milestoneBreakdown: milestones,
      status: 'pending',
      triggeredAt: new Date(),
    });
    const saved = await this.settleRepo.save(settlement);
    // 结算数据已备：由结算支付版块（关联方）执行真实资金划转
    return saved;
  }

  /** M→C #32 消费：收到关联方 settlement.completed 回写 → 状态 settled */
  async consumeSettlementCompleted(
    orderId: string,
    payload?: Record<string, unknown>,
  ): Promise<MarketplaceSettlement> {
    const settlement = await this.settleRepo.findOne({ where: { orderId } });
    if (!settlement) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_ORDER,
        `settlement not found for order ${orderId}`,
      );
    }
    settlement.status = 'settled';
    settlement.completedAt = new Date();
    const saved = await this.settleRepo.save(settlement);

    const order = await this.ordersRepo.findOne({ where: { id: orderId } });
    if (order) {
      order.settlementStatus = 'settled';
      await this.ordersRepo.save(order);
    }
    return { ...saved, _payload: payload } as MarketplaceSettlement;
  }

  /** 对账 #35：按订单查询结算状态 */
  async getByOrder(orderId: string) {
    const settlement = await this.settleRepo.findOne({ where: { orderId } });
    if (!settlement) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_ORDER,
        `settlement not found for order ${orderId}`,
      );
    }
    return {
      order_id: orderId,
      settlement_status: settlement.status,
      amount_cny: settlement.amountCny,
      completed_at: settlement.completedAt?.toISOString() ?? null,
    };
  }

  /** 对账 #36：Workspace 结算列表 */
  listByWorkspace(workspaceId: string): Promise<MarketplaceSettlement[]> {
    return this.settleRepo.find({ where: { workspaceId } });
  }

  /** 售后申诉期 7 天关闭扫描：投递 settlement.appeal-period-closed（#34） */
  async scanAppealPeriodClosed(now: Date): Promise<number> {
    const orders = await this.ordersRepo.find({
      where: {
        afterSaleDeadline: LessThanOrEqual(now),
        settlementStatus: 'settled',
      },
    });
    let closed = 0;
    for (const order of orders) {
      const settlement = await this.settleRepo.findOne({
        where: { orderId: order.id },
      });
      if (settlement && settlement.status !== 'appeal_closed') {
        settlement.status = 'appeal_closed';
        await this.settleRepo.save(settlement);
        await this.dispatcher.enqueue(
          'settlement.appeal_period_closed',
          consoleWebhookUrl(CONSOLE_WEBHOOK.settlementAppealPeriodClosed),
          {
            event_type: 'settlement.appeal_period_closed',
            order_id: order.id,
            project_id: order.projectId,
          },
        );
        closed += 1;
      }
    }
    return closed;
  }

  private async getOrThrowOrder(orderId: string): Promise<MarketplaceOrder> {
    const order = await this.ordersRepo.findOne({ where: { id: orderId } });
    if (!order) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_ORDER,
        `order not found: ${orderId}`,
      );
    }
    return order;
  }
}