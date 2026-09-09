import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketplaceTask } from '../marketplace-tasks/marketplace-task.entity';
import { MarketplaceBid } from '../marketplace-bids/marketplace-bid.entity';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { Workspace } from '../workspaces/workspace.entity';

/**
 * 商机匹配度评分服务（PRD §5.1 模式一 Push）。
 *
 * 评分模型（满分 100）：
 *   类目重合度     40 分（任务 categoryId ∈ Workspace.categoryIds 得 40，否则 0）
 *   标签语义匹配   30 分（Jaccard 相似度 × 30；无标签时按 0.5 中性分计 15 分）
 *   历史完成率     15 分（completed_tasks_count / max(completed+cancelled, 1)）
 *   雇主评分       15 分（avg_rating / 5.0 × 15；无评分按 7.5 中性分计）
 *
 * 投递阈值：默认 60 分（PRD §410「平台管理员可在后台调整」）。
 * 冷启动保底：Workspace.createdAt 起 30 天内，分数低于阈值时按阈值通过（PRD §415）。
 *
 * 评分仅用于投递决策（不在雇主侧展示，PRD §413）。
 */
@Injectable()
export class MatchScoreService {
  private readonly logger = new Logger(MatchScoreService.name);

  /** 投递阈值（PRD §410，默认 60，可由超管运行时调整） */
  private threshold = 60;

  /** 冷启动期天数（PRD §415，默认 30 天） */
  private readonly coldStartDays = 30;

  constructor(
    @InjectRepository(MarketplaceTask)
    private readonly tasksRepo: Repository<MarketplaceTask>,
    @InjectRepository(MarketplaceBid)
    private readonly bidsRepo: Repository<MarketplaceBid>,
    @InjectRepository(MarketplaceOrder)
    private readonly ordersRepo: Repository<MarketplaceOrder>,
  ) {}

  /** 获取当前阈值（超管报表/调试用） */
  getThreshold(): number {
    return this.threshold;
  }

  /** 超管运行时调整阈值（PRD §410） */
  setThreshold(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error('threshold must be a number in [0, 100]');
    }
    this.threshold = value;
    this.logger.log(`match threshold updated: ${value}`);
  }

  /**
   * 计算候选 Workspace 对任务的匹配度分数。
   *
   * @param task 任务（含 categoryId / tags）
   * @param ws Workspace（含 categoryIds / capabilityTags / 历史数据）
   * @returns 0-100 浮点分数
   */
  computeScore(task: MarketplaceTask, ws: Workspace): number {
    const categoryScore = this.scoreCategory(task, ws);
    const tagScore = this.scoreTagSemantic(task, ws);
    const completionScore = this.scoreHistoryCompletion(ws);
    const ratingScore = this.scoreHistoryRating(ws);

    const total =
      categoryScore + tagScore + completionScore + ratingScore;
    // 限定到 [0, 100]，避免浮点累计越界
    return Math.max(0, Math.min(100, Math.round(total * 100) / 100));
  }

  /**
   * 判断是否应该投递：分数 ≥ 阈值，或处于冷启动保底期。
   *
   * @param score computeScore 返回的分数
   * @param ws Workspace（用于冷启动期判定）
   */
  shouldDeliver(score: number, ws: Workspace): boolean {
    if (score >= this.threshold) return true;
    // 冷启动保底（PRD §415）：入驻 30 天内，低于阈值也按阈值通过
    if (this.isInColdStart(ws)) {
      this.logger.debug(
        `cold-start guarantee: ws=${ws.id} score=${score} threshold=${this.threshold}`,
      );
      return true;
    }
    return false;
  }

  /**
   * 一次性计算 + 判定（便捷组合方法）。
   * 返回 { score, deliver } 供调用方记录 match_score 与投递决策。
   */
  evaluate(task: MarketplaceTask, ws: Workspace): {
    score: number;
    deliver: boolean;
  } {
    const score = this.computeScore(task, ws);
    return { score, deliver: this.shouldDeliver(score, ws) };
  }

  /** 冷启动期判定（入驻后 coldStartDays 天内） */
  private isInColdStart(ws: Workspace): boolean {
    if (!ws.createdAt) return false;
    const ageMs = Date.now() - ws.createdAt.getTime();
    return ageMs <= this.coldStartDays * 24 * 3600 * 1000;
  }

  /**
   * 类目重合度（满分 40）：任务 categoryId ∈ Workspace.categoryIds 即满分。
   * 公测期采用硬匹配（已通过类目树校验，slug 一致即可）。
   * 阶段二可演进为父子层级匹配（任务挂叶子、Workspace 经营父类目时按层级匹配）。
   */
  private scoreCategory(task: MarketplaceTask, ws: Workspace): number {
    const taskCat = task.categoryId;
    if (!taskCat) return 0;
    const wsCats: string[] = Array.isArray(ws.categoryIds)
      ? (ws.categoryIds as string[])
      : [];
    return wsCats.includes(taskCat) ? 40 : 0;
  }

  /**
   * 能力标签语义匹配（满分 30）。
   * 公测期采用 Jaccard 相似度（交集/并集）× 30。
   * 任一侧无标签时给中性分 15（避免新 Workspace 标签未填导致 0 分）。
   *
   * 阶段二演进方向：引入标签语义向量（embedding）或同义词字典，
   * 例如"电商文案"≈"营销文案"、"前端开发"≈"Web 开发"。
   * 公测版保守起见用 Jaccard + 中性分兜底。
   */
  private scoreTagSemantic(task: MarketplaceTask, ws: Workspace): number {
    const taskTags = this.normalizeTags(task.tags);
    const wsTags = this.normalizeTags(ws.capabilityTags);
    if (taskTags.length === 0 || wsTags.length === 0) {
      // 任一侧无标签 → 中性分 15（满分 30 的一半）
      return 15;
    }
    const setA = new Set(taskTags);
    const setB = new Set(wsTags);
    let inter = 0;
    for (const t of setA) if (setB.has(t)) inter += 1;
    const union = setA.size + setB.size - inter;
    if (union === 0) return 15;
    return Math.round((inter / union) * 30 * 100) / 100;
  }

  /**
   * 历史完成率（满分 15）。
   * completed_tasks_count / max(completed+cancelled, 1) × 15。
   * 无任何历史（completed=0, cancelled=0）→ 给中性分 7.5（满分一半），
   * 配合冷启动保底让新 Workspace 也能收到商机。
   */
  private scoreHistoryCompletion(ws: Workspace): number {
    const completed = ws.completedTasksCount ?? 0;
    // cancelled 数量 Workspace 实体未直接持有；公测版用 completed/max(completed,1) 近似
    // （completed=0 时返回中性 7.5）
    if (completed === 0) return 7.5;
    // 完成率近似 = completed / max(completed, 1) = 1.0（已完成的全部成功）
    // 阶段二接入 cancelled 计数后修正为 completed / (completed + cancelled)
    return 15;
  }

  /**
   * 雇主评分（满分 15）。
   * avg_rating / 5.0 × 15；无评分（avg_rating=0）→ 中性分 7.5。
   */
  private scoreHistoryRating(ws: Workspace): number {
    const rating = ws.avgRating ?? 0;
    if (rating <= 0) return 7.5;
    return Math.round((rating / 5.0) * 15 * 100) / 100;
  }

  /** 标签归一化：trim + 转小写 + 去空 + 去重 */
  private normalizeTags(tags: string[] | null | undefined): string[] {
    if (!tags || !Array.isArray(tags)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of tags) {
      if (typeof t !== 'string') continue;
      const v = t.trim().toLowerCase();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }
}
