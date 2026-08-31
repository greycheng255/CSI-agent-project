/**
 * 竞标综合分（PRD §5.6.1）：
 * 综合分 = 0.4 × 历史评分归一化 + 0.3 × 报价性价比 + 0.3 × 提交时间新鲜度
 * - 评分归一化：线性归一 [0,1]；历史任务 < 3 单取行业平均分
 * - 报价性价比：(预算中位数 - 报价) / 预算中位数；低于中位 50% 反向扣分（防恶意低价）
 * - 时效：24h 内满分；72h 起衰减到 0
 * 综合分仅用于默认排序，不对雇主展示分数值。
 */
export const HISTORY_MIN_ORDERS = 3;
export const RATING_WEIGHT = 0.4;
export const PRICE_WEIGHT = 0.3;
export const FRESHNESS_WEIGHT = 0.3;
export const LOW_PRICE_PENALTY_THRESHOLD = 0.5;
export const FRESH_FULL_HOURS = 24;
export const FRESH_DECAY_END_HOURS = 72;

export interface CompositeScoreInput {
  avgRating: number; // 0-5
  industryAvgRating: number; // 0-5（新店兜底）
  completedTasksCount: number;
  priceCny: number;
  medianPriceCny: number;
  submittedAtMs: number;
  nowMs: number;
}

/** 历史评分归一化（含新店兜底规则） */
export function normalizedRating(input: CompositeScoreInput): number {
  const raw =
    input.completedTasksCount < HISTORY_MIN_ORDERS
      ? input.industryAvgRating
      : input.avgRating;
  return Math.min(Math.max(raw / 5, 0), 1);
}

/** 报价性价比（低于中位 50% → 反向扣分为 -1） */
export function priceScore(priceCny: number, medianPriceCny: number): number {
  if (medianPriceCny <= 0) return 0;
  if (priceCny <= medianPriceCny * LOW_PRICE_PENALTY_THRESHOLD) return -1;
  return (medianPriceCny - priceCny) / medianPriceCny;
}

/** 提交时间新鲜度：24h 满分，72h 线性衰减到 0 */
export function freshnessScore(submittedAtMs: number, nowMs: number): number {
  const hours = (nowMs - submittedAtMs) / 3_600_000;
  if (hours <= FRESH_FULL_HOURS) return 1;
  const decay =
    1 - (hours - FRESH_FULL_HOURS) / (FRESH_DECAY_END_HOURS - FRESH_FULL_HOURS);
  return Math.max(decay, 0);
}

/** 综合分（纯函数） */
export function compositeScore(input: CompositeScoreInput): number {
  return (
    RATING_WEIGHT * normalizedRating(input) +
    PRICE_WEIGHT * priceScore(input.priceCny, input.medianPriceCny) +
    FRESHNESS_WEIGHT * freshnessScore(input.submittedAtMs, input.nowMs)
  );
}

/** 中位数（空数组返回 0） */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}