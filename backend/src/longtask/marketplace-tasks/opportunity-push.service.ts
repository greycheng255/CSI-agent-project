import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketplaceTask } from './marketplace-task.entity';
import {
  OpportunityDispatch,
  OPPORTUNITY_DISPATCH_MODE,
} from './opportunity-dispatch.entity';
import { Workspace } from '../workspaces/workspace.entity';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';
import { CONSOLE_WEBHOOK, consoleWebhookUrl } from '../contract/console-endpoints';
import { MatchScoreService } from '../categories/match-score.service';

/**
 * 商机 Push（PRD §5.1 模式一）：按类目匹配 Workspace → outbox 投递
 * opportunity.pushed（Console 侧按 UNIQUE(workspace_id, marketplace_task_id) 幂等）。
 * 平台侧以 opportunity_dispatches 日志保证「同轮同模式不重复投」。
 *
 * 阶段二：引入 MatchScoreService 计算匹配度分数（PRD §5.1 §406-415）：
 *   - 类目重合度（40）+ 标签语义匹配（30）+ 历史完成率（15）+ 雇主评分（15）
 *   - 阈值默认 60，低于阈值不投递（除非冷启动保底 30 天内）
 *   - 评分写入 opportunity_dispatches.match_score 与 webhook payload
 *   - 评分仅用于投递决策，不在雇主侧展示（PRD §413）
 */
@Injectable()
export class OpportunityPushService {
  private readonly logger = new Logger(OpportunityPushService.name);

  constructor(
    @InjectRepository(MarketplaceTask)
    private readonly tasksRepo: Repository<MarketplaceTask>,
    @InjectRepository(OpportunityDispatch)
    private readonly dispatchRepo: Repository<OpportunityDispatch>,
    @InjectRepository(Workspace)
    private readonly workspacesRepo: Repository<Workspace>,
    private readonly dispatcher: WebhookDispatcherService,
    private readonly matchScoreService: MatchScoreService,
  ) {}

  /** 推送任务给类目匹配的 Workspace；返回本轮实际投递数量 */
  async pushTask(taskId: string, mode: (typeof OPPORTUNITY_DISPATCH_MODE)[number] = 'push'): Promise<number> {
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
        `task is not open for push (status=${task.status})`,
      );
    }
    if (!task.categoryId) {
      this.logger.warn(`task has no category, skip push | task=${taskId}`);
      return 0;
    }

    const candidates = await this.workspacesRepo.find({
      where: { displayStatus: 'active', receivePlatformPush: true },
    });

    let pushed = 0;
    let skippedByScore = 0;
    for (const ws of candidates) {
      // JS 层兜底过滤：状态/开关（与 repo where 条件双保险）+ 类目匹配
      if (ws.displayStatus !== 'active' || ws.receivePlatformPush !== true)
        continue;
      const categories: string[] = Array.isArray(ws.categoryIds)
        ? (ws.categoryIds as string[])
        : [];
      if (!categories.includes(task.categoryId!)) continue;

      // 阶段二：匹配度评分 + 阈值过滤（PRD §5.1 §406-415）
      const { score, deliver } = this.matchScoreService.evaluate(task, ws);
      if (!deliver) {
        skippedByScore += 1;
        continue;
      }

      const dup = await this.dispatchRepo.findOne({
        where: {
          marketplaceTaskId: taskId,
          workspaceId: ws.id,
          bidRound: task.bidRound,
          mode,
        },
      });
      if (dup) continue; // 同轮已投过，静默跳过

      const log = await this.dispatchRepo.save(
        this.dispatchRepo.create({
          marketplaceTaskId: taskId,
          workspaceId: ws.id,
          bidRound: task.bidRound,
          mode,
          matchScore: score, // PRD §5.1：评分写入投递日志
          pushedAt: new Date(),
        }),
      );

      // 契约 §9.1：信封结构（event_version/occurred_at/sent_at/source + data.task_brief）
      const now = new Date();
      await this.dispatcher.enqueue(
        'opportunity.pushed',
        consoleWebhookUrl(CONSOLE_WEBHOOK.opportunityPushed),
        {
          event_id: log.id,
          event_type: 'opportunity.pushed',
          event_version: 1,
          occurred_at: now.toISOString(),
          sent_at: now.toISOString(),
          source: 'marketplace',
          data: {
            opportunity_id: log.id,
            workspace_id: ws.id,
            marketplace_task_id: taskId,
            source_type: 'platform_push',
            match_score: score, // 真实评分（替换阶段一硬编码 100）
            task_brief: {
              title: task.title,
              description: task.description ?? '',
              category: task.categoryId,
              budget_range: {
                min: task.budgetMinCny ?? 0,
                max: task.budgetMaxCny ?? 0,
              },
              expected_delivery_date: task.expectedDeliveryAt
                ? task.expectedDeliveryAt.toISOString()
                : null,
              seat_limit: task.seatLimit,
              bid_round: task.bidRound,
              attachments: (task.attachmentUrls ?? []).map((url, i) => ({
                name: `attachment-${i + 1}`,
                url,
                type: 'file',
              })),
              published_at: task.createdAt
                ? task.createdAt.toISOString()
                : now.toISOString(),
              expires_at: task.expiresAt ? task.expiresAt.toISOString() : null,
            },
            pushed_at: now.toISOString(),
          },
        },
        log.id, // 投递日志行 id 作为稳定 event_id，重投不变（payload.event_id 同值）
      );
      pushed += 1;
    }
    if (skippedByScore > 0) {
      this.logger.log(
        `push skipped by score: ${skippedByScore} workspaces below threshold ${this.matchScoreService.getThreshold()} | task=${taskId}`,
      );
    }
    return pushed;
  }
}