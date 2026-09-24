import { tagSetSimilarity } from './match-scoring';
import type { WorkspaceCreditSummary } from '../workspaces/credit-scoring';

/**
 * 雇主侧「平台推荐工作室」推荐分（2026-09-24 定稿）。
 *
 * 推荐分 = 0.4 × 类目重合 + 0.2 × 能力标签相似度 + 0.4 × 信用数据
 *   信用数据（信用数据四项，平台自动计算）= 0.5 × 平均评分 + 0.3 × 按时交付率
 *                                          + 0.2 × 完成任务数 − 0.3 × 纠纷率
 *
 * 与 `match-scoring`（Push 投递决策，信用仅占 0.2）的区别：这里是雇主侧推荐，
 * 信用数据权重提高到 0.4，让「已完成单量 / 评分 / 按时交付率」真正主导排序。
 * 分数仅用于服务端排序与运营调优，不在雇主侧展示数值（PRD §5.6.1 同理）。
 */
export const RECOMMEND_WEIGHTS = {
  category: 0.4,
  tags: 0.2,
  credit: 0.4,
} as const;

export const CREDIT_WEIGHTS = {
  rating: 0.5,
  onTime: 0.3,
  completed: 0.2,
} as const;

export const DISPUTE_PENALTY_WEIGHT = 0.3;
/** 完成单量饱和点：达到该单量即拿满「完成数」维度 */
export const COMPLETED_SATURATION = 20;
/** 历史单量低于该值视为「新店」，评分维度按行业均分兜底（对齐 bid-scoring） */
export const NEW_SHOP_MIN_ORDERS = 3;
export const INDUSTRY_AVG_RATING = 3.5;
export const DEFAULT_COLD_START_DAYS = 30;
export const DEFAULT_RECOMMEND_LIMIT = 6;
export const MAX_RECOMMEND_LIMIT = 20;

export interface RecommendWorkspaceInput {
  categoryIds?: string[] | null;
  capabilityTags?: string[] | null;
  createdAt?: Date | string | null;
  credit: WorkspaceCreditSummary;
}

export interface RecommendScoreResult {
  /** 0-100 整数，仅服务端排序用 */
  score: number;
  breakdown: { category: number; tags: number; credit: number };
  /** 信用维度得分 0-1（便于运营核对） */
  creditScore: number;
  newShop: boolean;
  coldStart: boolean;
  /** 面向雇主展示的推荐理由（不暴露分数） */
  reasons: string[];
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function readColdStartDays(): number {
  const raw = Number(process.env.RECOMMEND_COLD_START_DAYS ?? DEFAULT_COLD_START_DAYS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_COLD_START_DAYS;
}

export function scoreWorkspaceRecommendation(
  input: {
    categoryId: string;
    taskTags?: string[] | null;
    workspace: RecommendWorkspaceInput;
  },
  opts?: { coldStartDays?: number; nowMs?: number },
): RecommendScoreResult {
  const coldStartDays = opts?.coldStartDays ?? readColdStartDays();
  const nowMs = opts?.nowMs ?? Date.now();

  const categories = (input.workspace.categoryIds ?? []).filter(
    (c) => typeof c === 'string',
  );
  const category = categories.includes(input.categoryId) ? 1 : 0;

  const similarity = tagSetSimilarity(
    input.taskTags ?? [],
    input.workspace.capabilityTags ?? [],
  );
  // 任务或工作室任一侧无标签 → 该维度不惩罚（给满分），避免误杀
  const tags = similarity === null ? 1 : similarity;

  const credit = input.workspace.credit;
  const completed = Math.max(0, credit.completedTasksCount || 0);
  const newShop = completed < NEW_SHOP_MIN_ORDERS;
  const rating = newShop
    ? INDUSTRY_AVG_RATING
    : Math.max(0, Math.min(credit.avgRating || 0, 5));
  const onTime = clamp01(credit.onTimeRate || 0);
  const dispute = clamp01(credit.disputeRate || 0);

  const creditScore = clamp01(
    CREDIT_WEIGHTS.rating * (rating / 5) +
      CREDIT_WEIGHTS.onTime * onTime +
      CREDIT_WEIGHTS.completed * (Math.min(completed, COMPLETED_SATURATION) / COMPLETED_SATURATION) -
      DISPUTE_PENALTY_WEIGHT * dispute,
  );

  const score = Math.round(
    (RECOMMEND_WEIGHTS.category * category +
      RECOMMEND_WEIGHTS.tags * tags +
      RECOMMEND_WEIGHTS.credit * creditScore) *
      100,
  );

  const createdAt = input.workspace.createdAt
    ? new Date(input.workspace.createdAt).getTime()
    : null;
  const coldStart =
    createdAt !== null &&
    nowMs - createdAt <= coldStartDays * 24 * 60 * 60 * 1000;

  const reasons: string[] = [];
  if (category) reasons.push(`经营类目匹配：${input.categoryId}`);
  if (similarity !== null && similarity > 0) {
    reasons.push(`能力标签匹配度 ${Math.round(similarity * 100)}%`);
  }
  if (completed > 0) reasons.push(`已完成 ${completed} 单`);
  if (credit.avgRating > 0) reasons.push(`平均评分 ${credit.avgRating.toFixed(1)}/5`);
  if (credit.onTimeRate > 0) {
    reasons.push(`按时交付率 ${Math.round(credit.onTimeRate * 100)}%`);
  }
  if (completed > 0 && dispute === 0) reasons.push('无纠纷记录');
  if (newShop) reasons.push('新店（历史单量不足，评分维度按行业均分兜底）');
  if (coldStart) reasons.push('新入驻 30 天内（平台保底推荐）');

  return {
    score,
    breakdown: {
      category: Math.round(category * 100),
      tags: Math.round(tags * 100),
      credit: Math.round(creditScore * 100),
    },
    creditScore,
    newShop,
    coldStart,
    reasons,
  };
}