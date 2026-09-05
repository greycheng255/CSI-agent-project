import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketplaceBid } from './marketplace-bid.entity';
import { MarketplaceTask } from '../marketplace-tasks/marketplace-task.entity';
import { Workspace } from '../workspaces/workspace.entity';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';
import {
  compositeScore,
  CompositeScoreInput,
  median,
} from './bid-scoring';

const SEAT_FULL_WINDOW_MS = 72 * 60 * 60 * 1000; // 72h 雇主决策倒计时
const INDUSTRY_AVG_RATING = 3.5; // 行业平均分占位（信誉体系立项前），0-5

export interface SubmitBidInput {
  taskId: string;
  workspaceId: string;
  priceCny: number;
  planSummary?: string | null;
  estimatedDeliveryAt?: Date | string | null;
  source?: 'push' | 'pull' | 'manual_assign';
  /** §21.4 W3：投标时点快照（Console 传入优先，缺省回退本地投影） */
  workspaceName?: string;
  workspaceAvatarUrl?: string;
}

export interface SubmitBidResult {
  bid: MarketplaceBid;
  seatTaken: number;
  seatLimit: number;
  seatFull: boolean;
  seatFullDeadline: Date | null;
}

export interface RankedBid {
  bid: MarketplaceBid;
  score: number;
  workspaceName: string | null;
  workspaceLogoUrl: string | null;
  platformRecommended: boolean;
}

@Injectable()
export class MarketplaceBidsService {
  constructor(
    @InjectRepository(MarketplaceBid)
    private readonly bidsRepo: Repository<MarketplaceBid>,
    @InjectRepository(MarketplaceTask)
    private readonly tasksRepo: Repository<MarketplaceTask>,
    @InjectRepository(Workspace)
    private readonly workspacesRepo: Repository<Workspace>,
  ) {}

  /**
   * 提交竞标并占席位（C→M 场景二）。
   * 席位满 → 409 CONFLICT_SEAT_FULL；同轮重复 → 409 CONFLICT_DUPLICATE；
   * 席位打满瞬间写入 72h 倒计时（seat_full_locked_at/deadline）。
   */
  async submit(input: SubmitBidInput): Promise<SubmitBidResult> {
    if (!Number.isInteger(input.priceCny) || input.priceCny <= 0) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        'price_cny must be a positive integer',
      );
    }
    const task = await this.tasksRepo.findOne({
      where: { id: input.taskId },
    });
    if (!task) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_TASK,
        `marketplace task not found: ${input.taskId}`,
      );
    }
    if (task.status !== 'open') {
      throw new ContractError(
        422,
        CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION,
        `task is not open for bidding (status=${task.status})`,
      );
    }

    const round = task.bidRound;
    const dup = await this.bidsRepo.findOne({
      where: {
        marketplaceTaskId: task.id,
        bidRound: round,
        workspaceId: input.workspaceId,
      },
    });
    if (dup) {
      throw new ContractError(
        409,
        CONTRACT_ERROR_CODE.CONFLICT_DUPLICATE,
        `workspace already bid in round ${round}`,
      );
    }

    if (task.seatTaken >= task.seatLimit) {
      throw new ContractError(
        409,
        CONTRACT_ERROR_CODE.CONFLICT_SEAT_FULL,
        'seat full',
      );
    }

    task.seatTaken += 1;
    if (task.seatTaken >= task.seatLimit) {
      const now = new Date();
      task.seatFullLockedAt = now;
      task.seatFullDeadline = new Date(now.getTime() + SEAT_FULL_WINDOW_MS);
    }
    await this.tasksRepo.save(task);

    // 席位快照（§21.4 W3）：Console 传入的投标时点档案优先，缺省回退本地投影
    const ws = input.workspaceName || input.workspaceAvatarUrl
      ? null
      : await this.workspacesRepo.findOne({
          where: { id: input.workspaceId },
        });

    const bid = this.bidsRepo.create({
      marketplaceTaskId: task.id,
      bidRound: round,
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName ?? ws?.name ?? null,
      workspaceLogoUrl: input.workspaceAvatarUrl ?? ws?.logoUrl ?? null,
      priceCny: input.priceCny,
      planSummary: input.planSummary ?? null,
      estimatedDeliveryAt: input.estimatedDeliveryAt
        ? new Date(input.estimatedDeliveryAt)
        : null,
      status: 'submitted',
      source: input.source ?? 'pull',
    });
    const saved = await this.bidsRepo.save(bid);

    return {
      bid: saved,
      seatTaken: task.seatTaken,
      seatLimit: task.seatLimit,
      seatFull: task.seatTaken >= task.seatLimit,
      seatFullDeadline: task.seatFullDeadline,
    };
  }

  /** 当前轮已提交竞标（供选标/驳回/大厅展示） */
  async listSubmitted(taskId: string): Promise<MarketplaceBid[]> {
    const task = await this.tasksRepo.findOne({ where: { id: taskId } });
    if (!task || task.status === 'draft') return [];
    return this.bidsRepo.find({
      where: {
        marketplaceTaskId: taskId,
        bidRound: task.bidRound,
        status: 'submitted',
      },
    });
  }

  /**
   * 竞标列表排序：默认综合分降序；source=push 且 Workspace 正常 →「平台推荐」标签。
   * 综合分仅在平台内部用于排序，不对雇主展示分数值（PRD §5.6.1）。
   */
  async rank(taskId: string, nowMs = Date.now()): Promise<RankedBid[]> {
    const bids = await this.listSubmitted(taskId);
    if (bids.length === 0) return [];

    const medianPrice = median(bids.map((b) => b.priceCny));
    const workspaces = new Map<string, Workspace>();
    for (const bid of bids) {
      if (!workspaces.has(bid.workspaceId)) {
        const ws = await this.workspacesRepo.findOne({
          where: { id: bid.workspaceId },
        });
        workspaces.set(bid.workspaceId, ws ?? ({} as Workspace));
      }
    }

    const ranked = bids.map((bid) => {
      const ws = workspaces.get(bid.workspaceId)!;
      const input: CompositeScoreInput = {
        avgRating: ws?.avgRating ?? 0,
        industryAvgRating: INDUSTRY_AVG_RATING,
        completedTasksCount: ws?.completedTasksCount ?? 0,
        priceCny: bid.priceCny,
        medianPriceCny: medianPrice,
        submittedAtMs: bid.createdAt
          ? new Date(bid.createdAt).getTime()
          : nowMs,
        nowMs,
      };
      return {
        bid,
        score: compositeScore(input),
        workspaceName: bid.workspaceName ?? ws?.name ?? null,
        workspaceLogoUrl: bid.workspaceLogoUrl ?? ws?.logoUrl ?? null,
        platformRecommended:
          bid.source === 'push' && ws?.displayStatus === 'active',
      };
    });

    return ranked.sort((a, b) => b.score - a.score);
  }
}