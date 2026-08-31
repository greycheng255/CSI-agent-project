import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import {
  MarketplaceDispute,
  DisputeResolution,
} from './dispute.entity';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';
import { CONSOLE_WEBHOOK, consoleWebhookUrl } from '../contract/console-endpoints';

const EVIDENCE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 举证窗口 3 天
const ARBITRATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 平台仲裁最多 7 天

/**
 * 长任务纠纷仲裁（T22，场景十，D3：仲裁平台侧完成）：
 * 纠纷发起 → 3 天举证 → 平台仲裁（≤7 天）→ 4 选项结果 → 终态 acknowledge。
 */
@Injectable()
export class DisputesService {
  constructor(
    @InjectRepository(MarketplaceDispute)
    private readonly disputeRepo: Repository<MarketplaceDispute>,
    private readonly dispatcher: WebhookDispatcherService,
  ) {}

  /** M→C #33/#39：雇主发起纠纷（7 天申诉期内） → 投递 project/dispute-raised */
  async raiseDispute(
    orderId: string,
    reason?: string | null,
  ): Promise<MarketplaceDispute> {
    const dispute = this.disputeRepo.create({
      orderId,
      status: 'evidence_open',
      evidenceDeadline: new Date(Date.now() + EVIDENCE_WINDOW_MS),
    });
    const saved = await this.disputeRepo.save(dispute);
    await this.dispatcher.enqueue(
      'project.dispute_raised',
      consoleWebhookUrl(CONSOLE_WEBHOOK.projectDisputeRaised),
      {
        event_type: 'project.dispute_raised',
        dispute_id: saved.id,
        order_id: orderId,
        reason: reason ?? null,
      },
    );
    return saved;
  }

  /** C→M #40：Agent Owner 提交举证 */
  async submitEvidence(
    disputeId: string,
    evidence: Record<string, unknown>,
  ): Promise<MarketplaceDispute> {
    const dispute = await this.getOrThrow(disputeId);
    if (dispute.status !== 'evidence_open' && dispute.status !== 'arbitrating') {
      throw new ContractError(
        422,
        CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION,
        `dispute not accepting evidence (status=${dispute.status})`,
      );
    }
    dispute.evidence = evidence;
    return this.disputeRepo.save(dispute);
  }

  /** 平台受理 → 启动仲裁（≤7 天），M→C #41 投递 arbitration-started */
  async startArbitration(disputeId: string): Promise<MarketplaceDispute> {
    const dispute = await this.getOrThrow(disputeId);
    if (dispute.status !== 'evidence_open') {
      throw new ContractError(
        422,
        CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION,
        `dispute cannot enter arbitration (status=${dispute.status})`,
      );
    }
    dispute.status = 'arbitrating';
    dispute.arbitrationDeadline = new Date(Date.now() + ARBITRATION_WINDOW_MS);
    const saved = await this.disputeRepo.save(dispute);
    await this.dispatcher.enqueue(
      'dispute.arbitration_started',
      consoleWebhookUrl(CONSOLE_WEBHOOK.disputeArbitrationStarted),
      {
        event_type: 'dispute.arbitration_started',
        dispute_id: disputeId,
        order_id: dispute.orderId,
      },
    );
    return saved;
  }

  /** 仲裁结果（4 选项），M→C #42 投递 arbitration-result */
  async resolve(
    disputeId: string,
    resolution: DisputeResolution,
    amountCny?: number | null,
  ): Promise<MarketplaceDispute> {
    const dispute = await this.getOrThrow(disputeId);
    if (dispute.status !== 'arbitrating') {
      throw new ContractError(
        422,
        CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION,
        `dispute cannot be resolved (status=${dispute.status})`,
      );
    }
    dispute.status = 'resolved';
    dispute.resolution = resolution;
    dispute.resolutionAmountCny = amountCny ?? null;
    const saved = await this.disputeRepo.save(dispute);
    await this.dispatcher.enqueue(
      'dispute.arbitration_result',
      consoleWebhookUrl(CONSOLE_WEBHOOK.disputeArbitrationResult),
      {
        event_type: 'dispute.arbitration_result',
        dispute_id: disputeId,
        order_id: dispute.orderId,
        resolution,
        amount_cny: amountCny ?? null,
      },
    );
    return saved;
  }

  /** C→M #43：Agent Owner 确认仲裁结果（终态；未获确认不得清重试上下文） */
  async acknowledge(disputeId: string): Promise<MarketplaceDispute> {
    const dispute = await this.getOrThrow(disputeId);
    if (dispute.status !== 'resolved') {
      throw new ContractError(
        422,
        CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION,
        `dispute must be resolved before acknowledge (status=${dispute.status})`,
      );
    }
    dispute.status = 'acknowledged';
    return this.disputeRepo.save(dispute);
  }

  /** 举证窗口 3 天到期 → 自动进入仲裁 */
  async scanEvidenceDeadlines(now: Date): Promise<number> {
    const due = await this.disputeRepo.find({
      where: {
        status: 'evidence_open',
        evidenceDeadline: LessThanOrEqual(now),
      },
    });
    for (const dispute of due) {
      await this.startArbitration(dispute.id);
    }
    return due.length;
  }

  private async getOrThrow(disputeId: string): Promise<MarketplaceDispute> {
    const dispute = await this.disputeRepo.findOne({
      where: { id: disputeId },
    });
    if (!dispute) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_ORDER,
        `dispute not found: ${disputeId}`,
      );
    }
    return dispute;
  }
}