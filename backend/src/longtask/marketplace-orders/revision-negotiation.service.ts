import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { MarketplaceRevisionNegotiation } from './negotiation.entity';
import { MarketplaceOrder } from './marketplace-order.entity';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';
import { CONSOLE_WEBHOOK, consoleWebhookUrl } from '../contract/console-endpoints';

const NEGOTIATION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // §3.2.6：2 天协商窗口归 Marketplace
const AFTER_SALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type NegotiationDecision = 'A' | 'B' | 'C' | 'D';

/**
 * 场景六 修订协商（T18，PRD §7.7.3）：
 * 2 天窗口 + 4 结构化选项；窗口超时**默认 C（接受当前交付）**。
 * C 生效时写 7 天售后申诉期（after_sale_deadline）。
 */
@Injectable()
export class RevisionNegotiationService {
  constructor(
    @InjectRepository(MarketplaceRevisionNegotiation)
    private readonly negotiationRepo: Repository<MarketplaceRevisionNegotiation>,
    @InjectRepository(MarketplaceOrder)
    private readonly ordersRepo: Repository<MarketplaceOrder>,
    private readonly dispatcher: WebhookDispatcherService,
  ) {}

  /** 启动 2 天协商窗口（#15） */
  async start(
    orderId: string,
    reason: string,
  ): Promise<MarketplaceRevisionNegotiation> {
    const negotiation = this.negotiationRepo.create({
      orderId,
      status: 'open',
      deadline: new Date(Date.now() + NEGOTIATION_WINDOW_MS),
    });
    const saved = await this.negotiationRepo.save(negotiation);
    await this.dispatcher.enqueue(
      'revision.negotiation_action',
      consoleWebhookUrl(CONSOLE_WEBHOOK.revisionNegotiationAction),
      {
        event_type: 'revision.negotiation_action',
        negotiation_id: saved.id,
        order_id: orderId,
        action: 'started',
        reason,
        deadline: saved.deadline?.toISOString() ?? null,
      },
    );
    return saved;
  }

  /** 4 选项决策（#16 双向） */
  async decide(
    orderId: string,
    negotiationId: string,
    decision: NegotiationDecision,
  ): Promise<MarketplaceRevisionNegotiation> {
    const negotiation = await this.getOrThrow(orderId, negotiationId);
    if (negotiation.status !== 'open') {
      throw new ContractError(
        422,
        CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION,
        `negotiation already resolved (status=${negotiation.status})`,
      );
    }
    negotiation.status = 'resolved';
    negotiation.decision = decision;
    const saved = await this.negotiationRepo.save(negotiation);

    await this.dispatcher.enqueue(
      'revision.negotiation_action',
      consoleWebhookUrl(CONSOLE_WEBHOOK.revisionNegotiationAction),
      {
        event_type: 'revision.negotiation_action',
        negotiation_id: negotiationId,
        order_id: negotiation.orderId,
        action: 'decided',
        decision,
      },
    );

    if (decision === 'C') {
      await this.acceptCurrent(negotiation.orderId);
    }
    // A：追加修订（revision_limit+2 在 Console 侧执行）；B：转 Spec 变更；D：转纠纷（阶段五链路）
    return saved;
  }

  /** 2 天窗口超时 → 默认 C（接受当前交付） */
  async scanNegotiationTimeouts(now: Date): Promise<number> {
    const open = await this.negotiationRepo.find({
      where: {
        status: 'open',
        deadline: LessThanOrEqual(now),
      },
    });
    for (const negotiation of open) {
      negotiation.status = 'resolved';
      negotiation.decision = 'C';
      await this.negotiationRepo.save(negotiation);
      await this.acceptCurrent(negotiation.orderId);
      await this.dispatcher.enqueue(
        'revision.negotiation_action',
        consoleWebhookUrl(CONSOLE_WEBHOOK.revisionNegotiationAction),
        {
          event_type: 'revision.negotiation_action',
          negotiation_id: negotiation.id,
          order_id: negotiation.orderId,
          action: 'expired_default_c',
          decision: 'C',
        },
      );
    }
    return open.length;
  }

  private async acceptCurrent(orderId: string): Promise<void> {
    const order = await this.ordersRepo.findOne({ where: { id: orderId } });
    if (!order) return;
    order.deliveryStatus = 'accepted';
    order.afterSaleDeadline = new Date(Date.now() + AFTER_SALE_WINDOW_MS);
    await this.ordersRepo.save(order);
  }

  private async getOrThrow(
    orderId: string,
    negotiationId: string,
  ): Promise<MarketplaceRevisionNegotiation> {
    const negotiation = await this.negotiationRepo.findOne({
      where: { id: negotiationId },
    });
    if (!negotiation || negotiation.orderId !== orderId) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_ORDER,
        `negotiation not found in order ${orderId}: ${negotiationId}`,
      );
    }
    return negotiation;
  }
}