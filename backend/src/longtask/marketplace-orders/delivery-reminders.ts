/**
 * 交付验收催办节奏（PRD §9.4/§11.1 P0）：第 5/9/13 天三级催办。
 * 纯函数：返回某个交付应触发催办的天数（已满且未过整天窗口）。
 */
export const DELIVERY_REMINDER_DAYS = [5, 9, 13] as const;

export function dueReminderDays(
  submittedAtMs: number,
  nowMs: number,
): number[] {
  const elapsedDays = (nowMs - submittedAtMs) / 86_400_000;
  return DELIVERY_REMINDER_DAYS.filter(
    (d) => elapsedDays >= d && elapsedDays < d + 1,
  );
}