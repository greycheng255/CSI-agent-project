import { DeadlineScannerCron } from './deadline-scanner.cron';

describe('DeadlineScannerCron（统一超时调度器，§3.2.6）', () => {
  const queryRunner = {
    connect: jest.fn(),
    query: jest.fn(),
    release: jest.fn(),
  };
  const dataSource = {
    createQueryRunner: jest.fn(() => queryRunner),
  } as never;

  const selectionService = { scanSeatFullTimeouts: jest.fn() };
  const tasksService = { scanExpired: jest.fn() };
  const specContractService = { scanSpecTimeouts: jest.fn() };
  const deliveryContractService = {
    scanAutoAccept: jest.fn(),
    countDueReminders: jest.fn(),
  };
  const revisionNegotiationService = { scanNegotiationTimeouts: jest.fn() };
  const settlementsService = { scanAppealPeriodClosed: jest.fn() };
  const disputesService = { scanEvidenceDeadlines: jest.fn() };
  const timeoutScanner = { scanDue: jest.fn() };

  let cron: DeadlineScannerCron;
  beforeEach(() => {
    jest.clearAllMocks();
    for (const fn of [
      selectionService.scanSeatFullTimeouts,
      tasksService.scanExpired,
      specContractService.scanSpecTimeouts,
      deliveryContractService.scanAutoAccept,
      deliveryContractService.countDueReminders,
      revisionNegotiationService.scanNegotiationTimeouts,
      settlementsService.scanAppealPeriodClosed,
      disputesService.scanEvidenceDeadlines,
    ]) {
      fn.mockResolvedValue(0);
    }
    timeoutScanner.scanDue.mockReturnValue([]);
    queryRunner.connect.mockResolvedValue(undefined);
    queryRunner.release.mockResolvedValue(undefined);
    cron = new DeadlineScannerCron(
      dataSource,
      selectionService as never,
      tasksService as never,
      specContractService as never,
      deliveryContractService as never,
      revisionNegotiationService as never,
      settlementsService as never,
      disputesService as never,
      timeoutScanner as never,
    );
  });

  it('取得 advisory lock 时串行执行全部扫描器并释放锁', async () => {
    queryRunner.query
      .mockResolvedValueOnce([{ locked: true }]) // lock
      .mockResolvedValueOnce([]); // unlock
    selectionService.scanSeatFullTimeouts.mockResolvedValueOnce(1);
    tasksService.scanExpired.mockResolvedValueOnce(2);

    await cron.scanDue();

    expect(selectionService.scanSeatFullTimeouts).toHaveBeenCalledTimes(1);
    expect(tasksService.scanExpired).toHaveBeenCalledTimes(1);
    expect(specContractService.scanSpecTimeouts).toHaveBeenCalledTimes(1);
    expect(deliveryContractService.scanAutoAccept).toHaveBeenCalledTimes(1);
    expect(deliveryContractService.countDueReminders).toHaveBeenCalledTimes(1);
    expect(revisionNegotiationService.scanNegotiationTimeouts).toHaveBeenCalledTimes(1);
    expect(settlementsService.scanAppealPeriodClosed).toHaveBeenCalledTimes(1);
    expect(disputesService.scanEvidenceDeadlines).toHaveBeenCalledTimes(1);
    expect(timeoutScanner.scanDue).toHaveBeenCalledTimes(1);
    expect(queryRunner.query).toHaveBeenLastCalledWith(
      'SELECT pg_advisory_unlock($1)',
      [728193401],
    );
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('未取得锁（另一实例扫描中）→ 跳过本轮且不执行扫描', async () => {
    queryRunner.query.mockResolvedValueOnce([{ locked: false }]);

    await cron.scanDue();

    expect(selectionService.scanSeatFullTimeouts).not.toHaveBeenCalled();
    expect(tasksService.scanExpired).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('任一扫描器抛错 → 记录错误但不外抛，仍释放锁', async () => {
    queryRunner.query
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([]);
    specContractService.scanSpecTimeouts.mockRejectedValueOnce(new Error('db down'));

    await expect(cron.scanDue()).resolves.toBeUndefined();

    expect(queryRunner.query).toHaveBeenLastCalledWith(
      'SELECT pg_advisory_unlock($1)',
      [728193401],
    );
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('LONGTASK_DEADLINE_SCANNER_ENABLED=false → 整体关闭（不建连接）', async () => {
    process.env.LONGTASK_DEADLINE_SCANNER_ENABLED = 'false';
    try {
      await cron.scanDue();
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    } finally {
      delete process.env.LONGTASK_DEADLINE_SCANNER_ENABLED;
    }
  });
});
