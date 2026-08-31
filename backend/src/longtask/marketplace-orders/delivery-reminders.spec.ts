import { dueReminderDays, DELIVERY_REMINDER_DAYS } from './delivery-reminders';

describe('delivery-reminders（T17：5/9/13 天三级催办）', () => {
  const DAY = 86_400_000;
  const t0 = 1_700_000_000_000;

  it('催办节奏常量', () => {
    expect(DELIVERY_REMINDER_DAYS).toEqual([5, 9, 13]);
  });

  it('未满 5 天不催办', () => {
    expect(dueReminderDays(t0, t0 + 4 * DAY)).toEqual([]);
  });

  it('第 5/9/13 天整天窗口内触发对应催办', () => {
    expect(dueReminderDays(t0, t0 + 5 * DAY + 3_600_000)).toEqual([5]);
    expect(dueReminderDays(t0, t0 + 9 * DAY + 3_600_000)).toEqual([9]);
    expect(dueReminderDays(t0, t0 + 13 * DAY + 3_600_000)).toEqual([13]);
  });

  it('窗口错过不重复触发', () => {
    expect(dueReminderDays(t0, t0 + 14 * DAY)).toEqual([]);
  });
});