import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from '../workspaces/workspace.entity';
import { MarketplaceBid } from '../marketplace-bids/marketplace-bid.entity';
import { OpportunityDispatch } from './opportunity-dispatch.entity';
import { MarketplaceTask } from './marketplace-task.entity';
import { creditSummaryOf } from '../workspaces/credit-scoring';
import {
  DEFAULT_RECOMMEND_LIMIT,
  MAX_RECOMMEND_LIMIT,
  scoreWorkspaceRecommendation,
} from './recommend-scoring';

export interface RecommendedWorkspace {
  workspaceId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  bio: string | null;
  capabilityTags: string[] | null;
  categoryIds: string[] | null;
  /** 信用数据四项（平台自动计算，展示用） */
  credit: {
    completedTasksCount: number;
    avgRating: number;
    onTimeRate: number;
    disputeRate: number;
  };
  newShop: boolean;
  /** 推荐分：仅服务端排序/运营核对用，雇主侧不展示数值 */
  matchScore: number;
  matchBreakdown: { category: number; tags: number; credit: number };
  /** 推荐理由（雇主侧展示），已剥离分数 */
  reasons: string[];
  /** 是否已收到本任务本轮的平台邀约（幂等标记，前端据此禁用「邀请竞标」） */
  invited: boolean;
  /** 是否为雇主自己名下的工作室（已排除，恒 false，保留字段便于排查） */
  selfOwned: boolean;
}

/**
 * 雇主侧「平台推荐工作室」（任务创建/发布后调用）：
 * 以信用数据（自动计算）+ 类目/标签匹配为推荐依据，排除已投标、已自持与停用工作室。
 */
@Injectable()
export class WorkspaceRecommendService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspacesRepo: Repository<Workspace>,
    @InjectRepository(MarketplaceBid)
    private readonly bidsRepo: Repository<MarketplaceBid>,
    @InjectRepository(OpportunityDispatch)
    private readonly dispatchRepo: Repository<OpportunityDispatch>,
  ) {}

  async recommendForTask(
    task: MarketplaceTask,
    limitRaw?: number,
  ): Promise<{
    taskId: string;
    categoryId: string | null;
    limit: number;
    candidateCount: number;
    items: RecommendedWorkspace[];
  }> {
    const limit = Math.min(
      Math.max(Math.trunc(limitRaw ?? DEFAULT_RECOMMEND_LIMIT) || DEFAULT_RECOMMEND_LIMIT, 1),
      MAX_RECOMMEND_LIMIT,
    );

    const [candidates, bids, dispatches] = await Promise.all([
      this.workspacesRepo.find({
        where: { displayStatus: 'active', receivePlatformPush: true },
      }),
      this.bidsRepo.find({
        where: { marketplaceTaskId: task.id, bidRound: task.bidRound },
      }),
      this.dispatchRepo.find({
        where: {
          marketplaceTaskId: task.id,
          bidRound: task.bidRound,
          mode: 'push',
        },
      }),
    ]);

    const biddingIds = new Set(bids.map((b) => b.workspaceId));
    const invitedIds = new Set(dispatches.map((d) => d.workspaceId));

    const scored = candidates
      .filter((ws) => !biddingIds.has(ws.id))
      .filter((ws) => !(task.employerUserId && ws.ownerUserId === task.employerUserId))
      .map((ws) => {
        const credit = creditSummaryOf(ws);
        const result = scoreWorkspaceRecommendation({
          categoryId: task.categoryId ?? '',
          taskTags: task.tags,
          workspace: {
            categoryIds: ws.categoryIds,
            capabilityTags: ws.capabilityTags,
            createdAt: ws.createdAt,
            credit,
          },
        });
        const item: RecommendedWorkspace = {
          workspaceId: ws.id,
          name: ws.name,
          slug: ws.slug,
          logoUrl: ws.logoUrl,
          bio: ws.bio,
          capabilityTags: ws.capabilityTags,
          categoryIds: ws.categoryIds,
          credit,
          newShop: result.newShop,
          matchScore: result.score,
          matchBreakdown: result.breakdown,
          reasons: result.reasons,
          invited: invitedIds.has(ws.id),
          selfOwned: false,
        };
        return item;
      })
      .sort((a, b) => b.matchScore - a.matchScore);

    return {
      taskId: task.id,
      categoryId: task.categoryId,
      limit,
      candidateCount: scored.length,
      items: scored.slice(0, limit),
    };
  }
}