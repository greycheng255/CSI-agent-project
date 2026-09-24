import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Workspace } from '../longtask/workspaces/workspace.entity';
import {
  NotificationDispatcherService,
} from './notification-dispatcher.service';

/** 三个业务场景对应的模板 ID 读取（env） */
function tmpl(key: string): string | null {
  return process.env[key]?.trim() ?? null;
}

/** 全部业务模板 env 键（供 fail-fast 启动校验用） */
const BUSINESS_TEMPLATE_KEYS = [
  'WECHAT_TMPL_BID_WON',
  'WECHAT_TMPL_ESCROW',
  'WECHAT_TMPL_SETTLEMENT',
  'WECHAT_TMPL_DELIVERY_REMINDER',
  'WECHAT_TMPL_DELIVERY_REMINDER_URGENT',
  'WECHAT_TMPL_EMPLOYER_MENTION',
] as const;

/**
 * 业务通知交付层：面向业务的统一入口，负责按 owner 反查 openid 并 enqueue。
 * 仅对接微信渠道；短信不用于业务通知（仅验证码）。发送不阻塞主流程（异步 outbox）。
 */
@Injectable()
export class NotificationDeliveryService implements OnModuleInit {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Workspace)
    private readonly workspacesRepo: Repository<Workspace>,
    private readonly dispatcher: NotificationDispatcherService,
  ) {}

  /** 启动即校验模板配置：非 mock 模式下暴露空模板 ID，降低上线后静默投递失败概率（P2b） */
  onModuleInit(): void {
    if (process.env.WECHAT_MOCK_MODE?.trim() === 'true') return;
    const missing = BUSINESS_TEMPLATE_KEYS.filter((k) => !tmpl(k));
    if (missing.length > 0) {
      this.logger.warn(
        `wechat templates not configured (通知将静默跳过): ${missing.join(',')}`,
      );
    }
  }

  /** 中标 → 通知中标工作室 owner */
  async notifyBidWon(
    workspaceId: string,
    marketplaceTaskId: string,
    orderId: string,
    taskTitle?: string | null,
  ): Promise<void> {
    const ownerId = await this.ownerIdByWorkspace(workspaceId);
    if (!ownerId) return this.warnMissingOwner('bid.won', workspaceId);
    await this.dispatcher.enqueue({
      noKey: `bid.won:${orderId}`,
      userId: ownerId,
      eventType: 'bid.won',
      templateId: tmpl('WECHAT_TMPL_BID_WON'),
      data: { taskTitle: taskTitle ?? '', orderId, marketplaceTaskId },
    });
  }

  /** 雇主支付托管到账 → 通知卖方 owner */
  async notifyEscrowPaid(
    workspaceId: string,
    orderId: string,
    amountCny: number,
  ): Promise<void> {
    const ownerId = await this.ownerIdByWorkspace(workspaceId);
    if (!ownerId) return this.warnMissingOwner('escrow.paid', workspaceId);
    await this.dispatcher.enqueue({
      noKey: `escrow.paid:${orderId}`,
      userId: ownerId,
      eventType: 'escrow.paid',
      templateId: tmpl('WECHAT_TMPL_ESCROW'),
      data: { orderId, amountCny },
    });
  }

  /** 结算到账 → 通知工作室 owner */
  async notifySettlement(
    workspaceId: string,
    orderId: string,
    amountCny: number,
  ): Promise<void> {
    const ownerId = await this.ownerIdByWorkspace(workspaceId);
    if (!ownerId) return this.warnMissingOwner('settlement.completed', workspaceId);
    await this.dispatcher.enqueue({
      noKey: `settlement.completed:${orderId}`,
      userId: ownerId,
      eventType: 'settlement.completed',
      templateId: tmpl('WECHAT_TMPL_SETTLEMENT'),
      data: { orderId, amountCny },
    });
  }

  /** 交付验收 5/9/13 天催办 → 通知雇主（PRD §9.4 催办节奏，已被选标方） */
  async notifyDeliveryReminder(
    employerUserId: string,
    data: {
      orderId: string;
      submissionSeq: number;
      submissionId: string;
      remainingDays: number;
      day: number;
    },
  ): Promise<void> {
    const urgent = data.day >= 13;
    // 第 13 天紧急模板未配置时降级复用普通催办模板，避免空投（P2b）
    let templateId = tmpl(
      urgent ? 'WECHAT_TMPL_DELIVERY_REMINDER_URGENT' : 'WECHAT_TMPL_DELIVERY_REMINDER',
    );
    if (urgent && !templateId) {
      templateId = tmpl('WECHAT_TMPL_DELIVERY_REMINDER');
      if (templateId) {
        this.logger.warn(
          `WECHAT_TMPL_DELIVERY_REMINDER_URGENT unset, degrading to normal template for day=${data.day}`,
        );
      }
    }
    await this.dispatcher.enqueue({
      // 幂等键：同一次提交的同一催办点位只发一次
      noKey: `delivery.reminder:${data.orderId}:${data.submissionSeq}:${data.day}`,
      userId: employerUserId,
      eventType: 'delivery.reminder',
      templateId,
      data: {
        orderId: data.orderId,
        submissionId: data.submissionId,
        submissionSeq: data.submissionSeq,
        remainingDays: data.remainingDays,
        day: data.day,
        urgent,
      },
    });
  }

  /**
   * Agent/Agent Owner @雇主提问 → 通知订单雇主（站内收件箱为主，微信为 best-effort）。
   * 模板未配置时 dispatcher 仍会落 outbox 记录（无 openid → skipped），雇主可在订单详情看到 Mention。
   */
  async notifyEmployerMention(
    employerUserId: string,
    data: {
      orderId: string;
      mentionId: string;
      fromDisplayName?: string | null;
      preview: string;
    },
  ): Promise<void> {
    await this.dispatcher.enqueue({
      // 幂等键：同一 mention 只推一次（Console 重推由 mention_id 去重后不会走到这里）
      noKey: `employer.mention:${data.mentionId}`,
      userId: employerUserId,
      eventType: 'employer.mention',
      templateId: tmpl('WECHAT_TMPL_EMPLOYER_MENTION'),
      data: {
        orderId: data.orderId,
        mentionId: data.mentionId,
        fromDisplayName: data.fromDisplayName ?? 'Agent',
        preview: data.preview,
      },
    });
  }

  /** 绑定回调用：把 openid 写到 user */
  async bindOpenid(userId: string, openid: string): Promise<boolean> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) return false;
    if (user.wechatOpenid === openid) return true;
    user.wechatOpenid = openid;
    await this.usersRepo.save(user);
    return true;
  }

  /** 供 Controller 查询绑定状态 */
  async hasOpenid(userId: string): Promise<boolean> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    return !!user?.wechatOpenid;
  }

  private async ownerIdByWorkspace(
    workspaceId: string,
  ): Promise<string | null> {
    if (!workspaceId) return null;
    const ws = await this.workspacesRepo.findOne({ where: { id: workspaceId } });
    return ws?.ownerUserId ?? null;
  }

  private warnMissingOwner(eventType: string, workspaceId: string): void {
    this.logger.warn(
      `notification skip: ${eventType} workspace=${workspaceId} owner-missing`,
    );
  }
}