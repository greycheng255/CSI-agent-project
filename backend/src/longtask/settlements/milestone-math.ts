/**
 * 里程碑结算金额公式（对接指南 §3.2 场景八）：
 * 结算金额 = Σ(里程碑权重 × Spec.final_price)，仅计 status="verified_passed" 的里程碑；
 * Spec 生成时校验所有 milestones 权重之和 = 100%。
 * 平台不自行发明"按完成比例估算"的算法（契约陷阱 8）。
 */
export interface Milestone {
  key?: string;
  weight?: number;
  status?: string;
}

const EPSILON = 1e-6;

/** 权重和是否 = 100% */
export function isWeightsSumValid(milestones: Milestone[]): boolean {
  if (!Array.isArray(milestones) || milestones.length === 0) return true; // 无里程碑不校验
  const sum = milestones.reduce((acc, m) => acc + (m.weight ?? 0), 0);
  return Math.abs(sum - 1) <= EPSILON;
}

/** 可结算金额：仅 verified_passed 里程碑计入 */
export function settlementAmount(
  milestones: Milestone[],
  finalPriceCny: number,
): number {
  if (!Array.isArray(milestones) || finalPriceCny <= 0) return 0;
  const settledWeight = milestones
    .filter((m) => m.status === 'verified_passed')
    .reduce((acc, m) => acc + (m.weight ?? 0), 0);
  return Math.round(settledWeight * finalPriceCny);
}