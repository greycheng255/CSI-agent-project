import { TimeoutRegistry } from './timeout-registry';

describe('TimeoutRegistry（超时注册表）', () => {
  it('登记与读取', () => {
    const reg = new TimeoutRegistry();
    reg.set('seat_full_decision', 1_000, { taskId: 't1' });
    expect(reg.has('seat_full_decision')).toBe(true);
    expect(reg.get('seat_full_decision')?.meta).toEqual({ taskId: 't1' });
  });

  it('同 key 覆盖（幂等登记）', () => {
    const reg = new TimeoutRegistry();
    reg.set('k', 1_000);
    reg.set('k', 2_000);
    expect(reg.get('k')?.dueAt).toBe(2_000);
    expect(reg.list()).toHaveLength(1);
  });

  it('scanDue 只摘除到期项且移除', () => {
    const reg = new TimeoutRegistry();
    reg.set('due1', 1_000);
    reg.set('due2', 999);
    reg.set('future', 2_000);

    const now = 1_000;
    const due = reg.scanDue(now);
    expect(due.map((d) => d.key).sort()).toEqual(['due1', 'due2']);
    expect(reg.has('due1')).toBe(false);
    expect(reg.has('due2')).toBe(false);
    expect(reg.has('future')).toBe(true);
  });

  it('delete 移除指定项', () => {
    const reg = new TimeoutRegistry();
    reg.set('k', 1_000);
    expect(reg.delete('k')).toBe(true);
    expect(reg.delete('k')).toBe(false);
  });
});