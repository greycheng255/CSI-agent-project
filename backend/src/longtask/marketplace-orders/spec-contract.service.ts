import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { MarketplaceOrder } from './marketplace-order.entity';
import { EmployerMention } from './employer-mention.entity';
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
import { hasSettlementBasis } from '../settlements/milestone-math';
import { NotificationDeliveryService } from '../../wechat/notification-delivery.service';

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

export interface EmployerMentionReplyInput {
  text: string;
  attachments?: unknown[];
  /** 回复人（订单雇主本人） */
  fromId?: string | null;
  fromDisplayName?: string | null;
}

/**
 * 场景四 Spec 契约（T15/T16）：
 * - C→M：收 employer-mentions（落库站内通知位 + best-effort 渠道通知）/ spec 提交
 *   （校验里程碑权重和=100%，启动 7 天计时）
 * - M→C：投递 employer-reply / spec.employer-action（confirmed/rejected/timeout）
 * - 7 天超时：发 spec.timeout → 订单取消 + 任务重开（bid_round+1、席位清零）
 * - spec_hash：Console 显式提交时只记录不重算（对接指南 §6 陷阱 16）；
 *   未提供时按平台默认口径补算（canonical JSON + SHA-256，见 contract/spec-hash.ts，
 *   执行方案 §7-2 未决项 #1 处置）
 */
@Injectable()
export class SpecContractService {
  private readonly logger = new Logger(SpecContractService.name);

  constructor(
    @InjectRepository(MarketplaceOrder)
    private readonly ordersRepo: Repository<MarketplaceOrder>,
    @InjectRepository(EmployerMention)
    private readonly mentionsRepo: Repository<EmployerMention>,
    private readonly tasksService: MarketplaceTasksService,
    private readonly cancelService: CancelSkeletonService,
    private readonly dispatcher: WebhookDispatcherService,
    private readonly timeoutScanner: TimeoutScannerService,
    private readonly notify: NotificationDeliveryService,
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
    // 结算依据（对接指南 §3.2.8，2026-09-23 补）：Spec 必须至少含 1 个非零权重里程碑。
    // 此前空里程碑被放行，落库后 settlementAmount 恒为 0（静默 0 元结算单），
    // 与 Console 侧提交前自检口径不一致 —— 现改为在契约边界返回结构化 422。
    if (!hasSettlementBasis(input.milestones ?? [])) {
      throw new ContractError(
        422,
        CONTRACT_ERROR_CODE.VALIDATION_MILESTONE_WEIGHT_INVALID,
        'spec lacks a settlement basis: at least one milestone with a non-zero weight is required',
      );
    }
    const sum = weights.reduce((acc, w) => acc + w, 0);
    if (Math.abs(sum - 1) > 1e-6) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        `milestone weights must sum to 100% (got ${sum})`,
      );
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

  /**
   * C→M #9：Console 推 Mention 给雇主（§13.2）。
   * 「站内通知位」落库：agent 提问进入雇主订单详情的收件箱，雇主回复后经
   * employer-reply 写回 Console Task Comment（§13.3）。按 mention_id 幂等，
   * 重复推送不新增行、不重复通知。
   */
  async receiveEmployerMention(
    orderId: string,
    mention: Record<string, unknown>,
  ): Promise<{ ok: boolean; mention_id: string; received_at: string; duplicate: boolean }> {
    // 订单存在性/归属校验（2026-09-02 Console 联调探测：不存在订单此前误返 201）
    const order = await this.getOrThrow(orderId);

    const mentionId = readString(mention.mention_id);
    if (!mentionId) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        'mention_id is required',
      );
    }
    if (!UUID_RE.test(mentionId)) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        'mention_id must be a uuid',
      );
    }
    const content = (
      mention.content && typeof mention.content === 'object'
        ? (mention.content as Record<string, unknown>)
        : {}
    );
    const text = readString(content.text);
    if (!text) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        'content.text is required',
      );
    }
    const from = (
      mention.from && typeof mention.from === 'object'
        ? (mention.from as Record<string, unknown>)
        : {}
    );
    const employerUserId = await this.resolveEmployerUserId(order);

    const existing = await this.mentionsRepo.findOne({ where: { mentionId } });
    if (existing) {
      return this.mentionAck(existing, true);
    }

    const row = this.mentionsRepo.create({
      mentionId,
      orderId,
      projectId: readOptionalUuid(mention.project_id, 'project_id') ?? order.projectId ?? null,
      projectTaskId: readOptionalUuid(mention.project_task_id, 'project_task_id'),
      sourceCommentId: readOptionalUuid(mention.source_comment_id, 'source_comment_id'),
      fromType: readString(from.type) ?? 'agent',
      fromId: readOptionalUuid(from.id, 'from.id'),
      fromDisplayName: readString(from.display_name) ?? null,
      content: {
        text,
        attachments: Array.isArray(content.attachments) ? content.attachments : [],
      },
      relatedSpecId: readOptionalUuid(mention.related_spec_id, 'related_spec_id'),
      relatedSpecVersion:
        typeof mention.related_spec_version === 'number'
          ? mention.related_spec_version
          : null,
      replyEndpointHint: readString(mention.reply_endpoint_hint) ?? null,
      employerUserId,
      status: 'pending',
      reply: null,
      repliedAt: null,
      sentAt: readDate(mention.sent_at),
    });

    let saved: EmployerMention;
    try {
      saved = await this.mentionsRepo.save(row);
    } catch (err) {
      // 并发同 mention_id：唯一约束兜底，回读后按重复处理
      const dup = await this.mentionsRepo.findOne({ where: { mentionId } });
      if (!dup) throw err;
      return this.mentionAck(dup, true);
    }

    // 渠道通知 best-effort：无 openid / 未配模板时仅站内可见，不阻断 Console 推送
    if (employerUserId) {
      try {
        await this.notify.notifyEmployerMention(employerUserId, {
          orderId,
          mentionId,
          fromDisplayName: row.fromDisplayName,
          preview: text,
        });
      } catch (err) {
        this.logger.warn(
          `employer mention notify failed (mention=${mentionId}): ${String(err)}`,
        );
      }
    } else {
      this.logger.warn(`employer mention without employer (order=${orderId})`);
    }

    return this.mentionAck(saved, false);
  }

  /** 雇主侧：本订单的 Mention 收件箱（新→旧） */
  listEmployerMentions(orderId: string): Promise<EmployerMention[]> {
    return this.mentionsRepo.find({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
  }

  /** 雇主侧：回复 Mention → 落库 + M→C employer-reply（Console 写成 Comment 并唤醒 Agent） */
  async employerReplyMention(
    orderId: string,
    mentionId: string,
    input: EmployerMentionReplyInput,
  ): Promise<EmployerMention> {
    const text = readString(input.text);
    if (!text) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        'text is required',
      );
    }
    const mention = await this.mentionsRepo.findOne({
      where: { id: mentionId, orderId },
    });
    if (!mention) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_MENTION,
        `mention not found: ${mentionId}`,
      );
    }
    if (mention.status !== 'pending') {
      throw new ContractError(
        422,
        CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION,
        `mention already replied (status=${mention.status})`,
      );
    }

    mention.status = 'replied';
    mention.reply = {
      text,
      attachments: input.attachments ?? [],
      from: {
        type: 'employer',
        id: input.fromId ?? mention.employerUserId ?? null,
        display_name: input.fromDisplayName ?? null,
      },
    };
    mention.repliedAt = new Date();
    const saved = await this.mentionsRepo.save(mention);

    await this.notifyEmployerReply(saved, input);
    return saved;
  }

  private mentionAck(
    row: EmployerMention,
    duplicate: boolean,
  ): { ok: boolean; mention_id: string; received_at: string; duplicate: boolean } {
    return {
      ok: true,
      mention_id: row.mentionId,
      received_at: (row.createdAt ?? new Date()).toISOString(),
      duplicate,
    };
  }

  /** 雇主用户：订单 employer_user_id 缺省回退任务发布者 */
  private async resolveEmployerUserId(
    order: MarketplaceOrder,
  ): Promise<string | null> {
    if (order.employerUserId) return order.employerUserId;
    const task = await this.tasksService.findById(order.marketplaceTaskId);
    return task?.employerUserId ?? null;
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
          workspace_id: order.workspaceId,
          marketplace_task_id: order.marketplaceTaskId,
          project_id: order.projectId,
          spec_id: order.id,
          spec_version: order.specVersion,
          revision_number: 1,
          confirmed_at: new Date().toISOString(),
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
        workspace_id: order.workspaceId,
        marketplace_task_id: order.marketplaceTaskId,
        project_id: order.projectId,
        spec_id: order.id,
        spec_version: order.specVersion,
        revision_number: 1,
        reject_reason: reason ?? null,
        rejected_at: new Date().toISOString(),
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
          workspace_id: order.workspaceId,
          marketplace_task_id: order.marketplaceTaskId,
          project_id: order.projectId,
          spec_id: order.id,
          spec_version: order.specVersion,
          next_action: 'auto_cancel',
          reason: 'employer_timeout',
          timed_out_at: new Date().toISOString(),
        },
      );
      // PRD §6.5.2：任务重开竞标进入下一轮
      await this.tasksService.reopenBidding(order.marketplaceTaskId);
    }
    return orders.length;
  }

  /**
   * M→C #10：雇主回复 Mention 写回（§13.3）。
   * 投递 payload 即 Console 期望的 `data` 内容（信封由 dispatcher 统一补齐
   * event_id/event_type/event_version/occurred_at/sent_at/source）；Console 收到后
   * 直接 INSERT 成 Task Comment（source='employer_reply'）并唤醒等待中的 Agent。
   */
  async notifyEmployerReply(
    mention: EmployerMention,
    input: EmployerMentionReplyInput,
  ): Promise<void> {
    const sentAt = new Date().toISOString();
    await this.dispatcher.enqueue(
      'task.employer_reply',
      consoleWebhookUrl(CONSOLE_WEBHOOK.employerReply),
      {
        mention_id: mention.mentionId,
        source_comment_id: mention.sourceCommentId,
        project_task_id: mention.projectTaskId,
        project_id: mention.projectId,
        order_id: mention.orderId,
        from: {
          type: 'employer',
          id: input.fromId ?? mention.employerUserId ?? null,
          display_name: input.fromDisplayName ?? null,
        },
        content: {
          text: input.text,
          attachments: input.attachments ?? [],
        },
        // 写回时挂在原提问 Comment 下（Console 侧 comment threading）
        in_reply_to_comment_id: mention.sourceCommentId,
        sent_at: sentAt,
      },
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

/** 契约入参取值：非空字符串（trim 后）才返回，其余一律 null（避免落 "undefined"） */
function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 契约入参取值：合法时间字符串 → Date，其余 null */
function readDate(value: unknown): Date | null {
  const raw = readString(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 契约入参取值：可选 uuid。
 * 缺省 → null；提供了但格式非法 → 400（§13.2 payload 格式错误），
 * 避免非法 uuid 直落 uuid 列触发 PG 22P02 变成 500。
 */
function readOptionalUuid(value: unknown, field: string): string | null {
  const raw = readString(value);
  if (!raw) return null;
  if (!UUID_RE.test(raw)) {
    throw new ContractError(
      400,
      CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
      `${field} must be a uuid`,
    );
  }
  return raw;
}