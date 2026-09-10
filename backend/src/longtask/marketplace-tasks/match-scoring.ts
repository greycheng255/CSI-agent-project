/**
 * 商机-工作室匹配度评分（PRD §5.1 模式一）：
 *   匹配度 = 0.5×类目重合 + 0.3×能力标签语义(词集 Jaccard) + 0.2×信用(完成数+评分)
 * 仅用于投递决策，不在雇主侧展示（PRD §5.6.1）。
 * 新 Workspace 冷启动：入驻 30 天内分数低于阈值也放行（PRD §5.1 冷启动保护）。
 */
export const MATCH_WEIGHTS = {
  category: 0.5,
  tags: 0.3,
  credit: 0.2,
} as const;

export const DEFAULT_MATCH_THRESHOLD = 60;
export const DEFAULT_COLD_START_DAYS = 30;

export interface MatchWorkspaceInput {
  categoryIds?: string[] | null;
  capabilityTags?: string[] | null;
  completedTasksCount?: number | null;
  avgRating?: number | string | null;
  createdAt?: Date | string | null;
}

export interface MatchScoreResult {
  /** 0-100 整数 */
  score: number;
  passed: boolean;
  coldStart: boolean;
  breakdown: { category: number; tags: number; credit: number };
}

/** 词集 Jaccard 相似度；任一侧为空返回 null（由调用方决定不惩罚） */
export function tagSetSimilarity(
  left: string[] | null | undefined,
  right: string[] | null | undefined,
): number | null {
  const norm = (arr: string[] | null | undefined) =>
    new Set(
      (arr ?? [])
        .filter((t) => typeof t === 'string')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    );
  const a = norm(left);
  const b = norm(right);
  if (a.size === 0 || b.size === 0) return null;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? null : inter / union;
}

function readThreshold(): number {
  const raw = Number(process.env.MATCH_SCORE_THRESHOLD ?? DEFAULT_MATCH_THRESHOLD);
  return Number.isFinite(raw) && raw >= 0 && raw <= 100
    ? raw
    : DEFAULT_MATCH_THRESHOLD;
}

function readColdStartDays(): number {
  const raw = Number(process.env.MATCH_COLD_START_DAYS ?? DEFAULT_COLD_START_DAYS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_COLD_START_DAYS;
}

export function scoreWorkspaceMatch(
  input: {
    categoryId: string;
    taskTags?: string[] | null;
    workspace: MatchWorkspaceInput;
  },
  opts?: { threshold?: number; coldStartDays?: number; nowMs?: number },
): MatchScoreResult {
  const threshold = opts?.threshold ?? readThreshold();
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
  // 任务无标签或工作室无标签 → 该维度不惩罚（给满分），避免误杀
  const tags = similarity === null ? 1 : similarity;

  const completed = Number(input.workspace.completedTasksCount ?? 0) || 0;
  const rating = Number(input.workspace.avgRating ?? 0) || 0;
  const credit =
    Math.min(completed, 10) / 20 + // 完成数 0-10 单 → 0-0.5
    Math.max(0, Math.min(rating, 5)) / 10; // 评分 0-5 → 0-0.5

  const raw =
    (MATCH_WEIGHTS.category * category +
      MATCH_WEIGHTS.tags * tags +
      MATCH_WEIGHTS.credit * credit) *
    100;
  const score = Math.round(raw);

  const createdAt = input.workspace.createdAt
    ? new Date(input.workspace.createdAt).getTime()
    : null;
  const coldStart =
    createdAt !== null &&
    nowMs - createdAt <= coldStartDays * 24 * 60 * 60 * 1000;

  return {
    score,
    passed: coldStart || score >= threshold,
    coldStart,
    breakdown: {
      category: Math.round(category * 100),
      tags: Math.round(tags * 100),
      credit: Math.round(credit * 100),
    },
  };
}
