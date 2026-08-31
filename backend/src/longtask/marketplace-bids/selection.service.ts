import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { MarketplaceBid } from './marketplace-bid.entity';
import { MarketplaceTask } from '../marketplace-tasks/marketplace-task.entity';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';
import { CONSOLE_WEBHOOK, consoleWebhookUrl } from '../contract/console-endpoints';

/**
 * 雇主选标 / 全部驳回 / 席位满 72h 自动驳回（PRD §5.6.2/§5.6.3/§5.3）。
 * 联动：选标 → bid.won webhook（Console 异步建 Project 后 PATCH 回填 project_id）；
 *       驳回/超时 → 任务重开（bid_round+1、席位清零）→ 每个受影响 Workspace 发 batch_rejected。
 */
@Injectable()
export class SelectionService {
  constructor(
    @InjectRepository(MarketplaceBid)
    private readonly bidsRepo: Repository<MarketplaceBid>,
    @InjectRepository(MarketplaceTask)
    private readonly tasksRepo: Repository<MarketplaceTask>,
    @InjectRepository(MarketplaceOrder)
    private readonly ordersRepo: Repository<MarketplaceOrder>,
    private readonly dispatcher: WebhookDispatcherService,
  ) {}

  /** 选标：winner=won、同轮其余=lost、任务→selected、建 Order、发 bid.won */
  async selectBid(taskId: string, bidId: string): Promise<MarketplaceOrder> {
    const task = await this.getOpenTask(taskId);
    const round = task.bidRound;

    const bid = await this.bidsRepo.findOne({
      where: { id: bidId, marketplaceTaskId: taskId },
    });
    if (!bid || bid.bidRound !== round || bid.status !== 'submitted') {
      throw new ContractError(
        422,
        CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION,
        `bid not selectable (id=${bidId}, round=${round})`,
      );
    }

    bid.status = 'won';
    await this.bidsRepo.save(bid);

    const others = await this.bidsRepo.find({
      where: {
        marketplaceTaskId: taskId,
        bidRound: round,
        status: 'submitted',
      },
    });
    for (const other of others) {
      other.status = 'lost';
      await this.bidsRepo.save(other);
    }

    task.status = 'selected';
    await this.tasksRepo.save(task);

    const order = this.ordersRepo.create({
      workspaceId: bid.workspaceId,
      marketplaceTaskId: taskId,
      bidId: bid.id,
      employerUserId: task.employerUserId,
      finalPriceCny: bid.priceCny,
      contractStatus: 'signing',
    });
    const saved = await this.ordersRepo.save(order);

    await this.dispatcher.enqueue(
      'bid.won',
      consoleWebhookUrl(CONSOLE_WEBHOOK.bidResult),
      {
        event_type: 'bid.won',
        marketplace_task_id: taskId,
        workspace_id: bid.workspaceId,
        order_id: saved.id,
        bid_round: round,
      },
    );

    return saved;
  }

  /** 全部驳回：当前轮 submitted→rejected、任务重开、每个受影响 Workspace 发 batch_rejected */
  async rejectAll(taskId: string): Promise<{ rejectedCount: number }> {
    const task = await this.getOpenTask(taskId);
    const round = task.bidRound;

    const submitted = await this.bidsRepo.find({
      where: {
        marketplaceTaskId: taskId,
        bidRound: round,
        status: 'submitted',
      },
    });

    const affectedWorkspaces = [...new Set(submitted.map((b) => b.workspaceId))];
    for (const bid of submitted) {
      bid.status = 'rejected';
      await this.bidsRepo.save(bid);
    }

    // 重开竞标：bid_round+1、席位归档清零、倒计时清空
    task.status = 'open';
    task.bidRound += 1;
    task.seatTaken = 0;
    task.seatFullDeadline = null;
    task.seatFullLockedAt = null;
    task.lastReopenedAt = new Date();
    await this.tasksRepo.save(task);

    for (const workspaceId of affectedWorkspaces) {
      await this.dispatcher.enqueue(
        'bid.batch_rejected',
        consoleWebhookUrl(CONSOLE_WEBHOOK.bidResult),
        {
          event_type: 'bid.batch_rejected',
          marketplace_task_id: taskId,
          workspace_id: workspaceId,
          bid_round: round,
        },
      );
    }

    return { rejectedCount: submitted.length };
  }

  /** 席位满 72h 到期未决策 → 自动全部驳回（PRD §5.3 防死锁） */
  async scanSeatFullTimeouts(now: Date): Promise<number> {
    const tasks = await this.tasksRepo.find({
      where: {
        status: 'open',
        seatFullDeadline: LessThanOrEqual(now),
      },
    });
    let rejected = 0;
    for (const task of tasks) {
      await this.rejectAll(task.id);
      rejected += 1;
    }
    return rejected;
  }

  private async getOpenTask(taskId: string): Promise<MarketplaceTask> {
    const task = await this.tasksRepo.findOne({ where: { id: taskId } });
    if (!task) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_TASK,
        `marketplace task not found: ${taskId}`,
      );
    }
    if (task.status !== 'open') {
      throw new ContractError(
        422,
        CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION,
        `task is not open (status=${task.status})`,
      );
    }
    return task;
  }
}