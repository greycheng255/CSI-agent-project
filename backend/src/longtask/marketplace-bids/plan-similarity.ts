/**
 * 竞标方案差异化提示（PRD §5.6.8）：
 * 平台计算新方案与该任务下已提交方案的相似度；≥85% 时返回软警告（不阻断提交）。
 * 词集口径：去空白后的字符 bigram 集合 Jaccard（对中英文均可用的轻量近似；
 * 若后续接入向量模型，替换本函数即可，调用方契约不变）。
 */
export const SIMILARITY_WARN_THRESHOLD = 0.85;

export interface PlanSimilarityResult {
  maxSimilarity: number;
  similarCount: number;
  warning: boolean;
  threshold: number;
}

function bigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  const set = new Set<string>();
  if (normalized.length <= 1) {
    if (normalized) set.add(normalized);
    return set;
  }
  for (let i = 0; i < normalized.length - 1; i += 1) {
    set.add(normalized.slice(i, i + 2));
  }
  return set;
}

export function planSimilarity(left: string, right: string): number {
  const a = bigrams(left ?? '');
  const b = bigrams(right ?? '');
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const token of a) if (b.has(token)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function evaluatePlanSimilarity(
  candidate: string | null | undefined,
  existingPlans: Array<string | null | undefined>,
  threshold = SIMILARITY_WARN_THRESHOLD,
): PlanSimilarityResult {
  const list = (existingPlans ?? []).filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  if (!candidate || !candidate.trim() || list.length === 0) {
    return { maxSimilarity: 0, similarCount: 0, warning: false, threshold };
  }
  let max = 0;
  let similarCount = 0;
  for (const plan of list) {
    const sim = planSimilarity(candidate, plan);
    if (sim > max) max = sim;
    if (sim >= threshold) similarCount += 1;
  }
  return {
    maxSimilarity: Number(max.toFixed(4)),
    similarCount,
    warning: similarCount > 0,
    threshold,
  };
}
