import {
  aggregateNotifications,
  levelForEvent,
  NOTIFICATION_LEVELS,
} from './notification-level';

describe('notification-level（PRD §7.9 分级 + 1h 聚合）', () => {
  it('事件 → 级别映射（spec.timeout/取消请求/纠纷为 urgent）', () => {
    expect(levelForEvent('spec.timeout')).toBe('urgent');
    expect(levelForEvent('project.cancel_request')).toBe('urgent');
    expect(levelForEvent('project.dispute_raised')).toBe('urgent');
    expect(levelForEvent('delivery.auto_accepted')).toBe('reminder');
    expect(levelForEvent('bid.won')).toBe('info');
  });

  it('未知事件默认 info（接收方忽略未知字段的兼容原则）', () => {
    expect(levelForEvent('unknown.event')).toBe('info');
    expect(NOTIFICATION_LEVELS).toContain(levelForEvent('unknown.event'));
  });

  it('同类型事件 1h 内聚合为一条并计数', () => {
    const t0 = new Date('2026-09-10T00:00:00Z').getTime();
    const result = aggregateNotifications([
      { eventType: 'delivery.rejected', at: new Date(t0).toISOString() },
      { eventType: 'delivery.rejected', at: new Date(t0 + 5 * 60_000).toISOString() },
      { eventType: 'delivery.rejected', at: new Date(t0 + 30 * 60_000).toISOString() },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(3);
    expect(result[0].level).toBe('reminder');
  });

  it('超过窗口 → 拆成两条；不同类型不合并', () => {
    const t0 = new Date('2026-09-10T00:00:00Z').getTime();
    const result = aggregateNotifications([
      { eventType: 'spec.rejected', at: new Date(t0).toISOString() },
      { eventType: 'spec.rejected', at: new Date(t0 + 2 * 3600_000).toISOString() },
      { eventType: 'spec.timeout', at: new Date(t0 + 2 * 3600_000).toISOString() },
    ]);
    expect(result).toHaveLength(3);
  });
});
