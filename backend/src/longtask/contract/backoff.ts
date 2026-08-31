/**
 * Webhook 投递退避策略（对接指南 §3.1）：
 * 5s/30s/2min/10min/1h 共 5 次退避；5 次失败进死信表 + 告警。
 */
export const WEBHOOK_BACKOFF_MS = [
  5_000, // 5s
  30_000, // 30s
  120_000, // 2min
  600_000, // 10min
  3_600_000, // 1h
] as const;

export const MAX_WEBHOOK_ATTEMPTS = WEBHOOK_BACKOFF_MS.length; // 5

/** 第 failedAttempts 次失败后应等待的时长（超上限钳制到最大值） */
export function backoffDelayFor(failedAttempts: number): number {
  const idx = Math.min(
    Math.max(failedAttempts - 1, 0),
    WEBHOOK_BACKOFF_MS.length - 1,
  );
  return WEBHOOK_BACKOFF_MS[idx];
}