import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MarketplaceTasksService } from './marketplace-tasks.service';
import { MarketplaceTask } from './marketplace-task.entity';
import { ContractError } from '../contract/errors';

describe('MarketplaceTasksService（T2：7 态状态机 + 席位/轮次字段）', () => {
  let service: MarketplaceTasksService;

  const mockRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketplaceTasksService,
        { provide: getRepositoryToken(MarketplaceTask), useValue: mockRepo },
      ],
    }).compile();
    service = module.get(MarketplaceTasksService);
  });

  function task(overrides: Partial<MarketplaceTask> = {}) {
    return {
      id: 't1',
      title: '任务',
      status: 'draft',
      seatLimit: 20,
      seatTaken: 0,
      bidRound: 1,
      expiresAt: null,
      seatFullDeadline: null,
      seatFullLockedAt: null,
      lastReopenedAt: null,
      ...overrides,
    } as MarketplaceTask;
  }

  it('创建任务即 draft，席位默认 20、bid_round=1', async () => {
    mockRepo.create.mockImplementation((v) => v);
    mockRepo.save.mockImplementation((v) => v);
    const t = await service.create({ title: '新任务' });
    expect(t.status).toBe('draft');
    expect(t.seatLimit).toBe(20);
    expect(t.bidRound).toBe(1);
  });

  it('seat_limit 非法 → 400', async () => {
    await expect(
      service.create({ title: 'x', seatLimit: 0 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('发布：draft→open 并写入 30 天有效期', async () => {
    mockRepo.findOne.mockResolvedValueOnce(task());
    mockRepo.save.mockImplementation((v) => v);
    const t = await service.publish('t1');
    expect(t.status).toBe('open');
    const days = (t.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30.01);
  });

  it('非法转移（closed 发布）→ 422 STATE_INVALID_TRANSITION', async () => {
    mockRepo.findOne.mockResolvedValueOnce(task({ status: 'closed' }));
    await expect(service.publish('t1')).rejects.toMatchObject({
      status: 422,
    });
  });

  it('选标：open→selected', async () => {
    mockRepo.findOne.mockResolvedValueOnce(task({ status: 'open' }));
    mockRepo.save.mockImplementation((v) => v);
    const t = await service.select('t1');
    expect(t.status).toBe('selected');
  });

  it('重开竞标：open 时 bid_round+1、席位与倒计时清零', async () => {
    mockRepo.findOne.mockResolvedValueOnce(
      task({
        status: 'open',
        bidRound: 2,
        seatTaken: 5,
        seatFullDeadline: new Date(),
        seatFullLockedAt: new Date(),
      }),
    );
    mockRepo.save.mockImplementation((v) => v);
    const t = await service.reopenBidding('t1');
    expect(t.status).toBe('open');
    expect(t.bidRound).toBe(3);
    expect(t.seatTaken).toBe(0);
    expect(t.seatFullDeadline).toBeNull();
    expect(t.seatFullLockedAt).toBeNull();
    expect(t.lastReopenedAt).not.toBeNull();
  });

  it('重开竞标：selected（Spec 超时重开）也可回 open', async () => {
    mockRepo.findOne.mockResolvedValueOnce(task({ status: 'selected' }));
    mockRepo.save.mockImplementation((v) => v);
    const t = await service.reopenBidding('t1');
    expect(t.status).toBe('open');
  });

  it('重开竞标：终态不可重开', async () => {
    mockRepo.findOne.mockResolvedValueOnce(task({ status: 'expired' }));
    await expect(service.reopenBidding('t1')).rejects.toMatchObject({
      status: 422,
    });
  });

  it('自然过期：open→expired', async () => {
    mockRepo.findOne.mockResolvedValueOnce(task({ status: 'open' }));
    mockRepo.save.mockImplementation((v) => v);
    const t = await service.expire('t1');
    expect(t.status).toBe('expired');
  });

  it('关闭 / 完成 / 取消 终态转移', async () => {
    mockRepo.findOne.mockResolvedValueOnce(task({ status: 'open' }));
    mockRepo.save.mockImplementation((v) => v);
    expect((await service.close('t1')).status).toBe('closed');

    mockRepo.findOne.mockResolvedValueOnce(task({ status: 'selected' }));
    expect((await service.complete('t1')).status).toBe('completed');

    mockRepo.findOne.mockResolvedValueOnce(task({ status: 'selected' }));
    expect((await service.cancel('t1')).status).toBe('cancelled');
  });

  it('未找到任务 → 404', async () => {
    mockRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.publish('missing')).rejects.toMatchObject({
      status: 404,
    });
    // ContractError 实例断言
    await expect(service.publish('missing')).rejects.toBeInstanceOf(
      ContractError,
    );
  });
});