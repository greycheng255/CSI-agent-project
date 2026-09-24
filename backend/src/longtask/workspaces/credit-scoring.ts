/**
 * 信用数据自动计算（PRD §5.6.7「信用数据（脱敏）」四项指标）。
 * 硬约束：平台基于交付与验收记录自动生成，工作室不可修改（写入口在 WorkspacesService.updateShowcase 被刻意排除）。
 *
 * 口径（M 侧自有真实数据，2026-09-24 定稿）：
 *  - 完成任务数  = 交付验收通过（order.delivery_status = accepted）的订单数
 *  - 平均评分    = 按雇主验收结果映射：首次交付即通过 5.0 / 经修订后通过 3.5 / 最终驳回 1.0
 *  - 按时交付率  = 首次交付提交时间 ≤ 任务期望交付时间 的已完成订单占比
 *  - 纠纷率      = 产生过纠纷仲裁的订单数 / 全部订单数
 */

/** 验收结果 → 平台评分映射（评价体系立项前的平台内部口径） */
export const DELIVERY_RATING = {
  firstPass: 5,
  afterRevision: 3.5,
  rejected: 1,
} as const;

/** 直接通过的交付状态 */
const FIRST_PASS_STATUSES: readonly string[] = ['accepted', 'auto_accepted'];

/** order.delivery_status 中代表「交付已验收通过」的值 */
const COMPLETED_ORDER_STATUSES: readonly string[] = ['accepted'];

export const AVG_RATING_SCALE = 2;
export const RATE_SCALE = 4;

/** 单订单信用事件事实（由 WorkspaceCreditService 从订单/交付/纠纷三表拼装） */
export interface CreditOrderFact {
  orderId: string;
  /** order.delivery_status：null / in_accept / accepted / revising */
  deliveryStatus: string | null;
  /** 该订单是否产生过纠纷仲裁记录 */
  hasDispute: boolean;
  /** 任务期望交付时间（任务未设置 → null，不计入按时交付率分母） */
  expectedDeliveryAt: Date | null;
  /** 首次交付（submission_seq 最小）的提交时间；无交付记录 → null */
  firstSubmittedAt: Date | null;
  /** 首次交付的验收结果；无交付记录 → null */
  firstDeliveryStatus: string | null;
  /** 该订单交付链路上是否出现过修订请求 */
  hadRevisionRequest: boolean;
  /** 该订单最终一次交付的验收结果（用于识别驳回终态） */
  lastDeliveryStatus: string | null;
}

export interface WorkspaceCreditSummary {
  completedTasksCount: number;
  avgRating: number;
  onTimeRate: number;
  disputeRate: number;
}

function roundTo(value: number, scale: number): number {
  const factor = 10 ** scale;
  return Math.round(value * factor) / factor;
}

/**
 * 单订单评分（0-5）；未形成可评价结论（未验收）返回 null，不计入平均分。
 * 优先级：终态驳回 1.0 < 修订后通过 3.5 < 首次交付即通过 5.0。
 */
export function deliveryOutcomeRating(fact: CreditOrderFact): number | null {
  if (fact.lastDeliveryStatus === 'rejected') return DELIVERY_RATING.rejected;
  const completed = COMPLETED_ORDER_STATUSES.includes(fact.deliveryStatus ?? '');
  if (!completed) return null;
  const firstPass =
    !fact.hadRevisionRequest &&
    FIRST_PASS_STATUSES.includes(fact.firstDeliveryStatus ?? '');
  return firstPass ? DELIVERY_RATING.firstPass : DELIVERY_RATING.afterRevision;
}

/** 从 workspaces 投影行读取信用摘要（pg numeric 可能返回字符串，统一归一化） */
export function creditSummaryOf(row: {
  completedTasksCount?: number | null;
  avgRating?: number | string | null;
  onTimeRate?: number | string | null;
  disputeRate?: number | string | null;
}): WorkspaceCreditSummary {
  const num = (value: number | string | null | undefined): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    completedTasksCount: num(row.completedTasksCount),
    avgRating: num(row.avgRating),
    onTimeRate: num(row.onTimeRate),
    disputeRate: num(row.disputeRate),
  };
}

/** 该订单是否按时交付（首次交付提交时间不晚于期望交付时间） */
export function isOnTimeDelivery(fact: CreditOrderFact): boolean | null {
  if (!fact.expectedDeliveryAt || !fact.firstSubmittedAt) return null;
  return (
    new Date(fact.firstSubmittedAt).getTime() <=
    new Date(fact.expectedDeliveryAt).getTime()
  );
}

/** 聚合出 workspace 信用数据四项（空事实集 → 全 0） */
export function computeWorkspaceCredit(
  facts: CreditOrderFact[],
): WorkspaceCreditSummary {
  const totalOrders = facts.length;
  if (totalOrders === 0) {
    return {
      completedTasksCount: 0,
      avgRating: 0,
      onTimeRate: 0,
      disputeRate: 0,
    };
  }

  const completed = facts.filter((f) =>
    COMPLETED_ORDER_STATUSES.includes(f.deliveryStatus ?? ''),
  );
  const ratings = completed
    .map((f) => deliveryOutcomeRating(f))
    .filter((r): r is number => r !== null);

  const onTimeSamples = completed
    .map((f) => isOnTimeDelivery(f))
    .filter((v): v is boolean => v !== null);

  const disputedOrders = facts.filter((f) => f.hasDispute).length;

  return {
    completedTasksCount: completed.length,
    avgRating: ratings.length
      ? roundTo(ratings.reduce((sum, r) => sum + r, 0) / ratings.length, AVG_RATING_SCALE)
      : 0,
    onTimeRate: onTimeSamples.length
      ? roundTo(
          onTimeSamples.filter(Boolean).length / onTimeSamples.length,
          RATE_SCALE,
        )
      : 0,
    disputeRate: roundTo(disputedOrders / totalOrders, RATE_SCALE),
  };
}