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
import { scoreWorkspaceMatch } from './match-scoring';
import { scoreWorkspaceRecommendation } from './recommend-scoring';
import { creditSummaryOf } from '../workspaces/credit-scoring';

export interface InviteWorkspaceResult {
  invited: boolean;
  alreadyInvited: boolean;
  opportunityId: string | null;
  workspaceId: string;
}

/** workspace_id 为 uuid 列，非 uuid 输入在查询前拒绝为 400（否则 PG 22P02 抛 500） */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 商机 Push（PRD §5.1 模式一）：按类目匹配 Workspace → outbox 投递
 * opportunity.pushed（Console 侧按 UNIQUE(workspace_id, marketplace_task_id) 幂等）。
 * 平台侧以 opportunity_dispatches 日志保证「同轮同模式不重复投」。
 *
 * 两条投递路径共用同一份投递实现与幂等键：
 *  - 自动 Push：`pushTask`（匹配度阈值 + 冷启动保底，match-scoring）
 *  - 雇主邀约：`inviteToTask`（任务页推荐列表「邀请竞标」，不设阈值，用推荐分上报）
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
  ) {}

  /** 推送任务给类目匹配的 Workspace；返回本轮实际投递数量 */
  async pushTask(taskId: string, mode: (typeof OPPORTUNITY_DISPATCH_MODE)[number] = 'push'): Promise<number> {
    const task = await this.loadOpenTask(taskId);
    if (!task.categoryId) {
      this.logger.warn(`task has no category, skip push | task=${taskId}`);
      return 0;
    }

    const candidates = await this.workspacesRepo.find({
      where: { displayStatus: 'active', receivePlatformPush: true },
    });

    let pushed = 0;
    for (const ws of candidates) {
      // JS 层兜底过滤：状态/开关（与 repo where 条件双保险）
      if (ws.displayStatus !== 'active' || ws.receivePlatformPush !== true)
        continue;

      // §5.1 匹配度评分（类目 + 标签 + 信用），阈值/冷启动可配置
      const match = scoreWorkspaceMatch({
        categoryId: task.categoryId,
        taskTags: task.tags,
        workspace: ws,
      });
      if (!match.passed) continue;

      const log = await this.dispatchOnce(task, ws, mode, match.score, match.breakdown, match.coldStart);
      if (log.created) pushed += 1;
    }
    return pushed;
  }

  /**
   * 雇主在任务页「邀请」指定工作室参与竞标（推荐列表动作）。
   * 不设匹配阈值（人工决策优先），复用同一投递日志与幂等键：
   * 同轮同 workspace 已投递过 → 幂等返回 alreadyInvited，不重复出站。
   */
  async inviteToTask(
    task: MarketplaceTask,
    workspaceId: string,
  ): Promise<InviteWorkspaceResult> {
    const taskId = task.id;
    if (task.status !== 'open') {
      throw new ContractError(
        422,
        CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION,
        `task is not open for invite (status=${task.status})`,
      );
    }
    if (!UUID_RE.test(workspaceId ?? '')) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        `invalid workspace id: ${workspaceId}`,
      );
    }
    const ws = await this.workspacesRepo.findOne({ where: { id: workspaceId } });
    if (!ws) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_WORKSPACE,
        `workspace not found: ${workspaceId}`,
      );
    }
    if (ws.displayStatus !== 'active') {
      throw new ContractError(
        422,
        CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION,
        `workspace is not available for invite (display_status=${ws.displayStatus})`,
      );
    }

    const recommend = scoreWorkspaceRecommendation({
      categoryId: task.categoryId ?? '',
      taskTags: task.tags,
      workspace: {
        categoryIds: ws.categoryIds,
        capabilityTags: ws.capabilityTags,
        createdAt: ws.createdAt,
        credit: creditSummaryOf(ws),
      },
    });

    const log = await this.dispatchOnce(
      task,
      ws,
      'push',
      recommend.score,
      recommend.breakdown,
      recommend.coldStart,
    );
    if (!log.created) {
      this.logger.log(
        `invite skipped (already dispatched) | task=${taskId} workspace=${workspaceId}`,
      );
    }
    return {
      invited: log.created,
      alreadyInvited: !log.created,
      opportunityId: log.id,
      workspaceId,
    };
  }

  /** 任务必须存在且处于 open（推送/邀约的共同前置） */
  private async loadOpenTask(taskId: string): Promise<MarketplaceTask> {
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
    return task;
  }

  /**
   * 投递一次（幂等）：同轮同 workspace 同 mode 已存在日志 → 直接返回既有记录。
   * 新投递时写日志 + 入 outbox（契约 §9.1 信封：event_version/occurred_at/sent_at/source）。
   */
  private async dispatchOnce(
    task: MarketplaceTask,
    ws: Workspace,
    mode: (typeof OPPORTUNITY_DISPATCH_MODE)[number],
    matchScore: number,
    matchBreakdown: Record<string, number>,
    coldStart: boolean,
  ): Promise<{ created: boolean; id: string }> {
    const dup = await this.dispatchRepo.findOne({
      where: {
        marketplaceTaskId: task.id,
        workspaceId: ws.id,
        bidRound: task.bidRound,
        mode,
      },
    });
    if (dup) return { created: false, id: dup.id };

    const log = await this.dispatchRepo.save(
      this.dispatchRepo.create({
        marketplaceTaskId: task.id,
        workspaceId: ws.id,
        bidRound: task.bidRound,
        mode,
        pushedAt: new Date(),
      }),
    );

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
          marketplace_task_id: task.id,
          source_type: 'platform_push',
          match_score: matchScore,
          match_breakdown: matchBreakdown,
          cold_start: coldStart,
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

    return { created: true, id: log.id };
  }
}