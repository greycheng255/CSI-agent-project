import { SsoCodeCleanupCron } from './sso-code-cleanup.cron';

describe('SsoCodeCleanupCron', () => {
  let cron: SsoCodeCleanupCron;
  let repository: { delete: jest.Mock };
  let loggerLog: jest.SpyInstance;

  beforeEach(() => {
    repository = { delete: jest.fn(async () => ({ affected: 3 })) };
    cron = new SsoCodeCleanupCron(repository as any);
    loggerLog = jest
      .spyOn((cron as any).logger, 'log')
      .mockImplementation(() => undefined);
  });

  it('清理过期超过 1 天的授权码', async () => {
    const before = Date.now();
    await cron.cleanupExpiredCodes();
    const after = Date.now();

    expect(repository.delete).toHaveBeenCalledTimes(1);
    const operator = repository.delete.mock.calls[0][0].expiresAt;
    // 传入的是 TypeORM LessThan 操作符，阈值为当前时间减 24 小时
    expect(operator.type).toBe('lessThan');
    const threshold = operator.value.getTime();
    expect(threshold).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000);
    expect(threshold).toBeLessThanOrEqual(after - 24 * 60 * 60 * 1000);
  });

  it('有清理结果时记录日志', async () => {
    await cron.cleanupExpiredCodes();
    expect(loggerLog).toHaveBeenCalledWith(
      'Cleaned up 3 expired SSO authorization code(s)',
    );
  });

  it('无过期授权码时不记录日志', async () => {
    repository.delete.mockResolvedValue({ affected: 0 });
    await cron.cleanupExpiredCodes();
    expect(loggerLog).not.toHaveBeenCalled();
  });
});
