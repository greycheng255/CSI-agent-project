import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Workspace } from '../longtask/workspaces/workspace.entity';
import {
  EnqueueInput,
  NotificationDispatcherService,
} from './notification-dispatcher.service';

/** 三个业务场景对应的模板 ID 读取（env） */
function tmpl(key: string): string | null {
  return process.env[key]?.trim() ?? null;
}

/**
 * 业务通知交付层：面向业务的统一入口，负责按 owner 反查 openid 并 enqueue。
 * 仅对接微信渠道；短信不用于业务通知（仅验证码）。发送不阻塞主流程（异步 outbox）。
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Workspace)
    private readonly workspacesRepo: Repository<Workspace>,
    private readonly dispatcher: NotificationDispatcherService,
  ) {}

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