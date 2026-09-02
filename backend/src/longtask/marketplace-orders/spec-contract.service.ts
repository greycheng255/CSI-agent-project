import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { MarketplaceOrder } from './marketplace-order.entity';
import { CancelSkeletonService } from './cancel-skeleton.service';
import { MarketplaceTasksService } from '../marketplace-tasks/marketplace-tasks.service';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';
import { TimeoutScannerService } from '../contract/timeout-scanner.service';
import { TIMEOUT_KEY } from '../contract/timeout-scanner.service';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';
import { CONSOLE_WEBHOOK, consoleWebhookUrl } from '../contract/console-endpoints';
import { computeSpecHash } from '../contract/spec-hash';

const SPEC_CONFIRM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // §3.2.6：Spec 7 天雇主未确认归 Marketplace
const SPEC_REJECTION_LIMIT = 5; // §3.2.6：驳回 5 次触发协商取消

export interface SubmitSpecInput {
  specContent?: unknown;
  specHash?: string | null;
  milestones?: Array<{
    key?: string;
    weight?: number;
    status?: string;
  }>;
}

/**
 * 场景四 Spec 契约（T15/T16）：
 * - C→M：收 employer-mentions / spec 提交（校验里程碑权重和=100%，启动 7 天计时）
 * - M→C：投递 employer-reply / spec.employer-action（confirmed/rejected/timeout）
 * - 7 天超时：发 spec.timeout → 订单取消 + 任务重开（bid_round+1、席位清零）
 * - spec_hash：Console 显式提交时只记录不重算（对接指南 §6 陷阱 16）；
 *   未提供时按平台默认口径补算（canonical JSON + SHA-256，见 contract/spec-hash.ts，
 *   执行方案 §7-2 未决项 #1 处置）
 */
@Injectable()
export class SpecContractService {
  constructor(
    @InjectRepository(MarketplaceOrder)
    private readonly ordersRepo: Repository<MarketplaceOrder>,
    private readonly tasksService: MarketplaceTasksService,
    private readonly cancelService: CancelSkeletonService,
    private readonly dispatcher: WebhookDispatcherService,
    private readonly timeoutScanner: TimeoutScannerService,
  ) {}

  /** C→M #11：Console 提交 Spec，启动 7 天计时 */
  async submitSpec(orderId: string, input: SubmitSpecInput): Promise<MarketplaceOrder> {
    const order = await this.getOrThrow(orderId);
    if (order.specVersion > 0) {
      throw new ContractError(
        409,
        CONTRACT_ERROR_CODE.CONFLICT_SPEC_VERSION,
        `spec already submitted (version=${order.specVersion})`,
      );
    }

    const weights = (input.milestones ?? []).map((m) => m.weight ?? 0);
    if (weights.length > 0) {
      const sum = weights.reduce((acc, w) => acc + w, 0);
      if (Math.abs(sum - 1) > 1e-6) {
        throw new ContractError(
          400,
          CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
          `milestone weights must sum to 100% (got ${sum})`,
        );
      }
    }

    order.specSnapshot = { content: input.specContent ?? null };
    order.specHash = input.specHash ?? computeSpecHash(input.specContent ?? null);
    order.specVersion = 1;
    order.milestones = input.milestones ?? null;
    order.contractStatus = 'awaiting_confirmation';
    order.specDeadline = new Date(Date.now() + SPEC_CONFIRM_WINDOW_MS);
    const saved = await this.ordersRepo.save(order);

    this.timeoutScanner.register(
      `${TIMEOUT_KEY.SPEC_EMPLOYER_CONFIRM}:${orderId}`,
      saved.specDeadline!.getTime(),
      { orderId },
    );
    return saved;
  }

  /** C→M #9：Console 推 Mention 给雇主（站内通知位，通知渠道接口预留） */
  async receiveEmployerMention(
    orderId: string,
    mention: Record<string, unknown>,
  ): Promise<{ ok: boolean; orderId: string; mention: Record<string, unknown> }> {
    // 订单存在性/归属校验（2026-09-02 Console 联调探测：不存在订单此前误返 201）
    await this.getOrThrow(orderId);
    return { ok: true, orderId, mention };
  }

  /** 雇主动作入口（平台 UI）：confirmed / rejected，并向 Console 投递 employer-action */
  async employerAction(
    orderId: string,
    action: 'confirmed' | 'rejected',
    reason?: string | null,
  ): Promise<MarketplaceOrder> {
    const order = await this.getOrThrow(orderId);
    if (order.contractStatus !== 'awaiting_confirmation') {
      throw new ContractError(
        422,
        CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION,
        `order is not awaiting spec confirmation (status=${order.contractStatus})`,
      );
    }

    if (action === 'confirmed') {
      order.contractStatus = 'signed';
      order.specDeadline = null;
      const saved = await this.ordersRepo.save(order);
      this.timeoutScanner.cancel(`${TIMEOUT_KEY.SPEC_EMPLOYER_CONFIRM}:${orderId}`);
      await this.dispatcher.enqueue(
        'spec.confirmed',
        consoleWebhookUrl(CONSOLE_WEBHOOK.specEmployerAction),
        {
          event_type: 'spec.confirmed',
          order_id: orderId,
          project_id: order.projectId,
          spec_version: order.specVersion,
        },
      );
      return saved;
    }

    // rejected：计数 + 投递 spec.rejected；驳回 5 次自动触发协商取消
    order.specRejectionCount = (order.specRejectionCount ?? 0) + 1;
    const saved = await this.ordersRepo.save(order);
    await this.dispatcher.enqueue(
      'spec.rejected',
      consoleWebhookUrl(CONSOLE_WEBHOOK.specEmployerAction),
      {
        event_type: 'spec.rejected',
        order_id: orderId,
        project_id: order.projectId,
        rejection_count: saved.specRejectionCount,
        reason: reason ?? null,
      },
    );
    if (saved.specRejectionCount >= SPEC_REJECTION_LIMIT) {
      await this.cancelService.initiateCancel(
        orderId,
        'spec_rejection_limit',
      );
    }
    return saved;
  }

  /** 7 天到期扫描：spec.timeout → 订单取消 + 任务重开（T16） */
  async scanSpecTimeouts(now: Date): Promise<number> {
    const orders = await this.ordersRepo.find({
      where: {
        contractStatus: 'awaiting_confirmation',
        specDeadline: LessThanOrEqual(now),
      },
    });
    for (const order of orders) {
      order.contractStatus = 'cancelled';
      order.specDeadline = null;
      await this.ordersRepo.save(order);
      this.timeoutScanner.cancel(
        `${TIMEOUT_KEY.SPEC_EMPLOYER_CONFIRM}:${order.id}`,
      );
      await this.dispatcher.enqueue(
        'spec.timeout',
        consoleWebhookUrl(CONSOLE_WEBHOOK.specEmployerAction),
        {
          event_type: 'spec.timeout',
          order_id: order.id,
          project_id: order.projectId,
        },
      );
      // PRD §6.5.2：任务重开竞标进入下一轮
      await this.tasksService.reopenBidding(order.marketplaceTaskId);
    }
    return orders.length;
  }

  /** M→C #10：雇主回复 Mention 写回（投递给 Console） */
  async notifyEmployerReply(
    orderId: string,
    reply: Record<string, unknown>,
  ): Promise<void> {
    await this.dispatcher.enqueue(
      'task.employer_reply',
      consoleWebhookUrl(CONSOLE_WEBHOOK.employerReply),
      { event_type: 'task.employer_reply', order_id: orderId, reply },
    );
  }

  private async getOrThrow(orderId: string): Promise<MarketplaceOrder> {
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