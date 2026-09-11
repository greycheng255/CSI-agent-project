import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MarketplaceCancelRequest,
} from './cancel-request.entity';
import { MarketplaceOrder } from './marketplace-order.entity';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';
import { CONSOLE_WEBHOOK, consoleWebhookUrl } from '../contract/console-endpoints';

/** 内部触发源 → Console source 枚举 */
const CANCEL_SOURCE_MAP = {
  employer: 'employer_initiated',
  spec_rejection_limit: 'spec_reject_5',
} as const;

/**
 * 场景八：协商取消与结算（骨架，T16b）。
 * - M→C 投递：project/cancel-request（雇主发起 / Spec 驳回 5 次自动触发）、
 *   cancel-counter-response（M5 放开）、cancel-resolution（auto_settled/to_dispute）
 * - C→M 接收：respond（accept/reject；counter_proposal 当前 422）、
 *   auto-resolve（Console 3 天超时自动处理）、finalize、to-dispute
 */
@Injectable()
export class CancelSkeletonService {
  constructor(
    @InjectRepository(MarketplaceCancelRequest)
    private readonly repo: Repository<MarketplaceCancelRequest>,
    @InjectRepository(MarketplaceOrder)
    private readonly ordersRepo: Repository<MarketplaceOrder>,
    private readonly dispatcher: WebhookDispatcherService,
  ) {}

  /** 发起协商取消（#24 触发源：雇主操作 / Spec 驳回 5 次） */
  async initiateCancel(
    orderId: string,
    trigger: 'employer' | 'spec_rejection_limit',
    projectId?: string | null,
  ): Promise<MarketplaceCancelRequest> {
    const request = this.repo.create({
      orderId,
      status: 'open',
      trigger,
    });
    const saved = await this.repo.save(request);
    const order = await this.orderOrThrow(orderId);
    await this.dispatcher.enqueue(
      'project.cancel_requested',
      consoleWebhookUrl(CONSOLE_WEBHOOK.projectCancelRequest),
      {
        event_type: 'project.cancel_requested',
        request_id: saved.id,
        order_id: orderId,
        workspace_id: order.workspaceId,
        marketplace_task_id: order.marketplaceTaskId,
        project_id: projectId ?? order.projectId,
        cancel_proposal_seq: saved.cancelProposalSeq ?? 1,
        source: CANCEL_SOURCE_MAP[trigger],
        reason: null,
        requested_at: saved.createdAt?.toISOString() ?? new Date().toISOString(),
      },
    );
    return saved;
  }

  /** C→M #25：Owner 响应（T19b：counter_proposal 已放开，M5 完整链路） */
  async respond(
    orderId: string,
    requestId: string,
    response: 'accept' | 'reject' | 'counter_proposal',
  ): Promise<MarketplaceCancelRequest> {
    const request = await this.getOrThrow(orderId, requestId);
    if (response === 'counter_proposal') {
      request.ownerResponse = response;
      request.status = 'counter_proposed';
      const saved = await this.repo.save(request);
      const order = await this.orderOrThrow(request.orderId);
      // M→C #27：雇主对部分结算方案响应（决策已定，送达 Console）
      await this.dispatcher.enqueue(
        'project.cancel_counter_response',
        consoleWebhookUrl(CONSOLE_WEBHOOK.projectCancelCounterResponse),
        {
          event_type: 'project.cancel_counter_response',
          request_id: requestId,
          order_id: request.orderId,
          workspace_id: order.workspaceId,
          marketplace_task_id: order.marketplaceTaskId,
          project_id: order.projectId,
          cancel_proposal_seq: request.cancelProposalSeq ?? 1,
          decision: 'accepted',
          responded_at: new Date().toISOString(),
        },
      );
      return saved;
    }
    request.ownerResponse = response;
    request.status = response === 'accept' ? 'accepted' : 'rejected';
    return this.repo.save(request);
  }

  /** C→M #26：Console 3 天超时自动处理结果（执行中→同意取消+部分结算；待验收→拒绝） */
  async autoResolve(
    orderId: string,
    requestId: string,
    outcome: 'accept_partial_settlement' | 'reject_cancel',
  ): Promise<MarketplaceCancelRequest> {
    const request = await this.getOrThrow(orderId, requestId);
    request.ownerResponse = outcome;
    request.status =
      outcome === 'accept_partial_settlement' ? 'accepted' : 'rejected';
    request.resolution = 'auto_resolved';
    return this.repo.save(request);
  }

  /** C→M #28：最终确认取消结算 → 投递 cancel-resolution(auto_settled) */
  async finalize(
    orderId: string,
    requestId: string,
  ): Promise<MarketplaceCancelRequest> {
    const request = await this.getOrThrow(orderId, requestId);
    request.status = 'finalized';
    request.resolution = 'auto_settled';
    const saved = await this.repo.save(request);
    const order = await this.orderOrThrow(request.orderId);
    await this.dispatcher.enqueue(
      'project.cancel_resolution',
      consoleWebhookUrl(CONSOLE_WEBHOOK.projectCancelResolution),
      {
        event_type: 'project.cancel_resolution',
        request_id: requestId,
        order_id: request.orderId,
        workspace_id: order.workspaceId,
        marketplace_task_id: order.marketplaceTaskId,
        project_id: order.projectId,
        cancel_proposal_seq: request.cancelProposalSeq ?? 1,
        result: 'auto_settled',
        resolved_at: new Date().toISOString(),
      },
    );
    return saved;
  }

  /** C→M #30：转纠纷（无可结算里程碑）→ 投递 cancel-resolution(to_dispute) */
  async toDispute(
    orderId: string,
    requestId: string,
  ): Promise<MarketplaceCancelRequest> {
    const request = await this.getOrThrow(orderId, requestId);
    request.status = 'to_dispute';
    request.resolution = 'to_dispute';
    const saved = await this.repo.save(request);
    const order = await this.orderOrThrow(request.orderId);
    await this.dispatcher.enqueue(
      'project.cancel_resolution',
      consoleWebhookUrl(CONSOLE_WEBHOOK.projectCancelResolution),
      {
        event_type: 'project.cancel_resolution',
        request_id: requestId,
        order_id: request.orderId,
        workspace_id: order.workspaceId,
        marketplace_task_id: order.marketplaceTaskId,
        project_id: order.projectId,
        cancel_proposal_seq: request.cancelProposalSeq ?? 1,
        result: 'to_dispute',
        resolved_at: new Date().toISOString(),
      },
    );
    return saved;
  }

  private async getOrThrow(
    orderId: string,
    requestId: string,
  ): Promise<MarketplaceCancelRequest> {
    if (!requestId || requestId === 'undefined' || requestId.length > 64) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_ORDER,
        `cancel request not found in order ${orderId}: ${requestId}`,
      );
    }
    const request = await this.repo.findOne({ where: { id: requestId } });
    if (!request || request.orderId !== orderId) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_ORDER,
        `cancel request not found in order ${orderId}: ${requestId}`,
      );
    }
    return request;
  }

  private async orderOrThrow(orderId: string): Promise<MarketplaceOrder> {
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