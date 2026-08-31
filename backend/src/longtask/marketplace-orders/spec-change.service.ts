import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketplaceSpecChange } from './spec-change.entity';
import { MarketplaceOrder } from './marketplace-order.entity';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';
import { CONSOLE_WEBHOOK, consoleWebhookUrl } from '../contract/console-endpoints';

/**
 * 场景七 Spec 变更（T19）：
 * - M→C #18：雇主发起修订/变更请求（启动 Console 24h 判定）
 * - C→M #19：Console 判定（revision / new_requirement）；new_requirement →
 *   M→C #20 雇主二次确认
 * - C→M #21-23：变更提案（3 天对方响应计时）/ 确认（Spec version+1）/ 拒绝
 * 幂等键：UNIQUE(order_id, change_seq)。
 */
@Injectable()
export class SpecChangeService {
  constructor(
    @InjectRepository(MarketplaceSpecChange)
    private readonly changeRepo: Repository<MarketplaceSpecChange>,
    @InjectRepository(MarketplaceOrder)
    private readonly ordersRepo: Repository<MarketplaceOrder>,
    private readonly dispatcher: WebhookDispatcherService,
  ) {}

  /** M→C #18：雇主发起变更请求 → 投递 spec-change/request 给 Console */
  async employerRequestChange(
    orderId: string,
    changeSeq: number,
    payload: Record<string, unknown>,
  ): Promise<MarketplaceSpecChange> {
    const order = await this.getOrThrowOrder(orderId);
    const dup = await this.findChange(orderId, changeSeq);
    if (dup) {
      throw new ContractError(
        409,
        CONTRACT_ERROR_CODE.CONFLICT_DUPLICATE,
        `change seq ${changeSeq} already exists`,
      );
    }
    const change = this.changeRepo.create({
      orderId,
      changeSeq,
      status: 'requested',
      payload,
    });
    const saved = await this.changeRepo.save(change);
    await this.dispatcher.enqueue(
      'spec_change.request',
      consoleWebhookUrl(CONSOLE_WEBHOOK.specChangeRequest),
      {
        event_type: 'spec_change.request',
        request_id: saved.id,
        order_id: orderId,
        project_id: order.projectId,
        change_seq: changeSeq,
      },
    );
    return saved;
  }

  /** C→M #19：Console 判定修订/新增需求（24h 判定归 Console） */
  async classify(
    changeId: string,
    classification: 'revision' | 'new_requirement',
  ): Promise<MarketplaceSpecChange> {
    const change = await this.getOrThrowChange(changeId);
    change.classification = classification;
    change.status = 'classified';
    const saved = await this.changeRepo.save(change);

    if (classification === 'new_requirement') {
      await this.dispatcher.enqueue(
        'spec_change.employer_confirmation',
        consoleWebhookUrl(CONSOLE_WEBHOOK.specChangeEmployerConfirmation),
        {
          event_type: 'spec_change.employer_confirmation',
          request_id: changeId,
          order_id: change.orderId,
        },
      );
    }
    return saved;
  }

  /** C→M #21：变更提案（3 天对方响应计时） */
  async propose(
    orderId: string,
    changeSeq: number,
    payload: Record<string, unknown>,
  ): Promise<MarketplaceSpecChange> {
    await this.getOrThrowOrder(orderId);
    const existing = await this.findChange(orderId, changeSeq);
    if (existing && existing.status !== 'requested') {
      throw new ContractError(
        409,
        CONTRACT_ERROR_CODE.CONFLICT_DUPLICATE,
        `change seq ${changeSeq} already exists`,
      );
    }
    const change =
      existing ?? this.changeRepo.create({ orderId, changeSeq, payload });
    change.payload = payload;
    change.status = 'proposed';
    return this.changeRepo.save(change);
  }

  /** C→M #22：确认 → Spec version+1（历史版本不可改） */
  async confirm(changeId: string): Promise<MarketplaceSpecChange> {
    const change = await this.getOrThrowChange(changeId);
    if (change.status === 'confirmed') return change; // 幂等
    change.status = 'confirmed';
    const saved = await this.changeRepo.save(change);

    const order = await this.ordersRepo.findOne({
      where: { id: change.orderId },
    });
    if (order) {
      order.specVersion = (order.specVersion ?? 0) + 1;
      await this.ordersRepo.save(order);
    }
    return saved;
  }

  /** C→M #23：拒绝 */
  async reject(changeId: string): Promise<MarketplaceSpecChange> {
    const change = await this.getOrThrowChange(changeId);
    change.status = 'rejected';
    return this.changeRepo.save(change);
  }

  private findChange(
    orderId: string,
    changeSeq: number,
  ): Promise<MarketplaceSpecChange | null> {
    return this.changeRepo.findOne({ where: { orderId, changeSeq } });
  }

  private async getOrThrowChange(
    changeId: string,
  ): Promise<MarketplaceSpecChange> {
    const change = await this.changeRepo.findOne({ where: { id: changeId } });
    if (!change) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_ORDER,
        `spec change not found: ${changeId}`,
      );
    }
    return change;
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