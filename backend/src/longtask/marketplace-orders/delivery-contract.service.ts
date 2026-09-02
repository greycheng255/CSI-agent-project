import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { MarketplaceDelivery } from './delivery.entity';
import { MarketplaceOrder } from './marketplace-order.entity';
import { RevisionNegotiationService } from './revision-negotiation.service';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';
import { CONSOLE_WEBHOOK, consoleWebhookUrl } from '../contract/console-endpoints';
import { dueReminderDays } from './delivery-reminders';

const AUTO_ACCEPT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // §3.2.6：14 天自动验收归 Marketplace
const AFTER_SALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 售后申诉期 7 天
const DEFAULT_REVISION_LIMIT = 2;

export interface SubmitDeliverableInput {
  metadata?: Record<string, unknown> | null;
  artifactUrls?: string[] | null;
  submissionSeq?: number;
}

/**
 * 场景五 交付验收（T17）：
 * - C→M #13：接收交付物（仅 metadata + 签名 URL），启动 14 天验收计时
 * - M→C #14：投递 delivery.accepted / rejected / revision_requested / auto_accepted
 * - 14 天到期 → 自动验收 + 写 7 天售后申诉期；5/9/13 天三级催办
 */
@Injectable()
export class DeliveryContractService {
  constructor(
    @InjectRepository(MarketplaceDelivery)
    private readonly deliveryRepo: Repository<MarketplaceDelivery>,
    @InjectRepository(MarketplaceOrder)
    private readonly ordersRepo: Repository<MarketplaceOrder>,
    private readonly negotiationService: RevisionNegotiationService,
    private readonly dispatcher: WebhookDispatcherService,
  ) {}

  async submitDeliverable(
    orderId: string,
    input: SubmitDeliverableInput,
  ): Promise<MarketplaceDelivery> {
    const order = await this.getOrThrowOrder(orderId);
    const seq = input.submissionSeq ?? 1;

    const dup = await this.deliveryRepo.findOne({
      where: { orderId, submissionSeq: seq },
    });
    if (dup) {
      throw new ContractError(
        409,
        CONTRACT_ERROR_CODE.CONFLICT_DUPLICATE,
        `deliverable seq ${seq} already submitted`,
      );
    }

    const now = new Date();
    const delivery = this.deliveryRepo.create({
      orderId,
      submissionSeq: seq,
      metadata: input.metadata ?? null,
      artifactUrls: input.artifactUrls ?? null,
      status: 'submitted',
      reviewRound: 0,
      submittedAt: now,
      acceptDeadline: new Date(now.getTime() + AUTO_ACCEPT_WINDOW_MS),
    });
    const saved = await this.deliveryRepo.save(delivery);

    order.deliveryStatus = 'in_accept';
    await this.ordersRepo.save(order);
    return saved;
  }

  /** 雇主动作（平台 UI）：accepted / rejected / revision_requested */
  async employerReview(
    orderId: string,
    action: 'accepted' | 'rejected' | 'revision_requested',
    reason?: string | null,
  ): Promise<MarketplaceDelivery> {
    const order = await this.getOrThrowOrder(orderId);
    const delivery = await this.deliveryRepo.findOne({
      where: { orderId, status: 'submitted' },
      order: { submissionSeq: 'DESC' },
    });
    if (!delivery) {
      throw new ContractError(
        422,
        CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION,
        'no pending delivery to review',
      );
    }

    const eventType =
      action === 'accepted'
        ? 'delivery.accepted'
        : action === 'rejected'
          ? 'delivery.rejected'
          : 'delivery.revision_requested';
    delivery.status = action;
    const saved = await this.deliveryRepo.save(delivery);

    // 订单侧联动先落库，再投递（payload 需携带落库后的 deadline）
    if (action === 'accepted') {
      order.deliveryStatus = 'accepted';
      order.afterSaleDeadline = new Date(Date.now() + AFTER_SALE_WINDOW_MS);
      await this.ordersRepo.save(order);
    } else if (action === 'revision_requested') {
      order.deliveryStatus = 'revising';
      await this.ordersRepo.save(order);
    }

    await this.dispatcher.enqueue(
      eventType,
      consoleWebhookUrl(CONSOLE_WEBHOOK.deliveryEmployerReview),
      {
        event_type: eventType,
        order_id: orderId,
        project_id: order.projectId,
        submission_seq: saved.submissionSeq,
        reason: reason ?? null,
        // A2 闭账字段：accepted 携带售后申诉期截止；revision_requested 携带当前
        // accept_deadline（修订期间计时冻结——scan 只扫 submitted，修订后再提交重置）
        accept_deadline: saved.acceptDeadline?.toISOString() ?? null,
        after_sale_deadline:
          action === 'accepted' ? order.afterSaleDeadline?.toISOString() ?? null : null,
      },
    );

    if (action === 'revision_requested') {
      const submittedCount = order.specVersion > 0 ? saved.submissionSeq : 0;
      // 修订次数超限（revision_limit 默认 2）→ 进入 2 天修订协商窗口
      if (submittedCount >= DEFAULT_REVISION_LIMIT) {
        await this.negotiationService.start(orderId, 'revision_exhausted');
      }
    }
    return saved;
  }

  /** 14 天到期：无操作 → 自动验收（PRD §9.4 三条硬约束由 Console 保证，平台按计时触发） */
  async scanAutoAccept(now: Date): Promise<number> {
    const pending = await this.deliveryRepo.find({
      where: {
        status: 'submitted',
        acceptDeadline: LessThanOrEqual(now),
      },
    });
    for (const delivery of pending) {
      delivery.status = 'auto_accepted';
      await this.deliveryRepo.save(delivery);

      const order = await this.ordersRepo.findOne({
        where: { id: delivery.orderId },
      });
      if (order) {
        order.deliveryStatus = 'accepted';
        order.afterSaleDeadline = new Date(now.getTime() + AFTER_SALE_WINDOW_MS);
        await this.ordersRepo.save(order);
      }
      await this.dispatcher.enqueue(
        'delivery.auto_accepted',
        consoleWebhookUrl(CONSOLE_WEBHOOK.deliveryEmployerReview),
        {
          event_type: 'delivery.auto_accepted',
          order_id: delivery.orderId,
          project_id: order?.projectId ?? null,
          submission_seq: delivery.submissionSeq,
          accept_deadline: delivery.acceptDeadline?.toISOString() ?? null,
          after_sale_deadline: order?.afterSaleDeadline?.toISOString() ?? null,
        },
      );
    }
    return pending.length;
  }

  /** 5/9/13 天三级催办（reminder 级） */
  dueReminders(
    delivery: MarketplaceDelivery,
    nowMs = Date.now(),
  ): number[] {
    if (!delivery.submittedAt) return [];
    return dueReminderDays(new Date(delivery.submittedAt).getTime(), nowMs);
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