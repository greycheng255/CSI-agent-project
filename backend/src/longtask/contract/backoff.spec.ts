import { backoffDelayFor, MAX_WEBHOOK_ATTEMPTS, WEBHOOK_BACKOFF_MS } from './backoff';

describe('backoff（契约 §3.1 退避 5s/30s/2min/10min/1h）', () => {
  it('退避序列与契约一致', () => {
    expect(WEBHOOK_BACKOFF_MS).toEqual([
      5_000,
      30_000,
      120_000,
      600_000,
      3_600_000,
    ]);
    expect(MAX_WEBHOOK_ATTEMPTS).toBe(5);
  });

  it('第 N 次失败后的等待时长', () => {
    expect(backoffDelayFor(1)).toBe(5_000);
    expect(backoffDelayFor(2)).toBe(30_000);
    expect(backoffDelayFor(3)).toBe(120_000);
    expect(backoffDelayFor(4)).toBe(600_000);
    expect(backoffDelayFor(5)).toBe(3_600_000);
  });

  it('超过上限钳制到最大值', () => {
    expect(backoffDelayFor(6)).toBe(3_600_000);
    expect(backoffDelayFor(100)).toBe(3_600_000);
    expect(backoffDelayFor(0)).toBe(5_000);
  });
});