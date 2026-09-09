import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MarketplaceBidsService } from './marketplace-bids.service';
import { MarketplaceBid } from './marketplace-bid.entity';
import { MarketplaceTask } from '../marketplace-tasks/marketplace-task.entity';
import { Workspace } from '../workspaces/workspace.entity';
import { ContractError } from '../contract/errors';

describe('MarketplaceBidsService（T8/T9：席位 + 幂等 + 排序）', () => {
  let service: MarketplaceBidsService;

  const mockBidsRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };
  const mockTasksRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };
  const mockWorkspacesRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketplaceBidsService,
        { provide: getRepositoryToken(MarketplaceBid), useValue: mockBidsRepo },
        {
          provide: getRepositoryToken(MarketplaceTask),
          useValue: mockTasksRepo,
        },
        { provide: getRepositoryToken(Workspace), useValue: mockWorkspacesRepo },
      ],
    }).compile();
    service = module.get(MarketplaceBidsService);
  });

  function openTask(overrides: Partial<MarketplaceTask> = {}) {
    return {
      id: 'task-1',
      status: 'open',
      seatLimit: 3,
      seatTaken: 0,
      bidRound: 1,
      seatFullDeadline: null,
      seatFullLockedAt: null,
      employerUserId: 'emp-1',
      ...overrides,
    } as MarketplaceTask;
  }

  it('提交竞标成功并占 1 个席位', async () => {
    const task = openTask();
    mockTasksRepo.findOne.mockResolvedValueOnce(task);
    mockBidsRepo.findOne.mockResolvedValueOnce(null); // 无重复
    mockBidsRepo.create.mockImplementation((v) => v);
    mockBidsRepo.save.mockImplementation((v) => v);

    const result = await service.submit({
      taskId: 'task-1',
      workspaceId: 'ws-1',
      priceCny: 1000,
    });
    expect(result.seatTaken).toBe(1);
    expect(result.seatFull).toBe(false);
    expect(task.seatTaken).toBe(1);
  });

  it('席位打满瞬间写入 72h 倒计时', async () => {
    const task = openTask({ seatTaken: 2 }); // limit=3
    mockTasksRepo.findOne.mockResolvedValueOnce(task);
    mockBidsRepo.findOne.mockResolvedValueOnce(null);
    mockBidsRepo.create.mockImplementation((v) => v);
    mockBidsRepo.save.mockImplementation((v) => v);

    const result = await service.submit({
      taskId: 'task-1',
      workspaceId: 'ws-1',
      priceCny: 1000,
    });
    expect(result.seatFull).toBe(true);
    expect(task.seatFullLockedAt).not.toBeNull();
    const windowMs =
      task.seatFullDeadline!.getTime() - task.seatFullLockedAt!.getTime();
    expect(windowMs).toBe(72 * 60 * 60 * 1000);
  });

  it('席位满 → 409 CONFLICT_SEAT_FULL', async () => {
    mockTasksRepo.findOne.mockResolvedValueOnce(
      openTask({ seatTaken: 3 }),
    );
    await expect(
      service.submit({ taskId: 'task-1', workspaceId: 'ws-9', priceCny: 1 }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('同轮重复竞标 → 409 CONFLICT_DUPLICATE', async () => {
    mockTasksRepo.findOne.mockResolvedValueOnce(openTask());
    mockBidsRepo.findOne.mockResolvedValueOnce({ id: 'b1' });
    await expect(
      service.submit({ taskId: 'task-1', workspaceId: 'ws-1', priceCny: 1 }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('任务未找到 → 404；非 open 状态 → 422', async () => {
    mockTasksRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.submit({ taskId: 'x', workspaceId: 'ws-1', priceCny: 1 }),
    ).rejects.toMatchObject({ status: 404 });

    mockTasksRepo.findOne.mockResolvedValueOnce(openTask({ status: 'selected' }));
    await expect(
      service.submit({ taskId: 'x', workspaceId: 'ws-1', priceCny: 1 }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('价格非法 → 400', async () => {
    await expect(
      service.submit({ taskId: 'x', workspaceId: 'ws-1', priceCny: -5 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('排序：综合分降序 + 平台推荐标签规则', async () => {
    const task = openTask();
    mockTasksRepo.findOne.mockResolvedValueOnce(task);
    mockBidsRepo.find.mockResolvedValueOnce([
      {
        id: 'b1',
        marketplaceTaskId: 'task-1',
        bidRound: 1,
        workspaceId: 'ws-1',
        priceCny: 900,
        status: 'submitted',
        source: 'push',
        createdAt: new Date('2026-08-27T00:00:00Z'),
      },
      {
        id: 'b2',
        marketplaceTaskId: 'task-1',
        bidRound: 1,
        workspaceId: 'ws-2',
        priceCny: 700,
        status: 'submitted',
        source: 'pull',
        createdAt: new Date('2026-08-27T00:00:00Z'),
      },
    ] as unknown as MarketplaceBid[]);
    mockWorkspacesRepo.findOne.mockImplementation(({ where }) =>
      where.id === 'ws-1'
        ? { id: 'ws-1', name: 'A 工作室', avgRating: 5, completedTasksCount: 10, displayStatus: 'active' }
        : { id: 'ws-2', name: 'B 工作室', avgRating: 3, completedTasksCount: 1, displayStatus: 'active' },
    );

    const ranked = await service.rank('task-1', Date.parse('2026-08-27T00:00:00Z'));
    // 复算综合分：b1(ws-1)=0.4×1.0 + 0.3×(-0.125) + 0.3×1 = 0.6625
    //             b2(ws-2 新店取行业均值 3.5)=0.4×0.7 + 0.3×0.125 + 0.3×1 = 0.6175
    expect(ranked[0].bid.id).toBe('b1');
    expect(ranked[1].bid.id).toBe('b2');
    expect(ranked[0].score).toBeCloseTo(0.6625, 4);
    // 只有 push 来源 + active 展示「平台推荐」
    expect(ranked[0].platformRecommended).toBe(true);
    expect(ranked[1].platformRecommended).toBe(false);
  });

  it('排序：冻结状态的 push workspace 不显示平台推荐', async () => {
    mockTasksRepo.findOne.mockResolvedValueOnce(openTask());
    mockBidsRepo.find.mockResolvedValueOnce([
      {
        id: 'b1',
        marketplaceTaskId: 'task-1',
        bidRound: 1,
        workspaceId: 'ws-1',
        priceCny: 900,
        status: 'submitted',
        source: 'push',
        createdAt: new Date('2026-08-27T00:00:00Z'),
      },
    ] as unknown as MarketplaceBid[]);
    mockWorkspacesRepo.findOne.mockResolvedValue({
      id: 'ws-1',
      name: 'A',
      avgRating: 5,
      completedTasksCount: 10,
      displayStatus: 'frozen',
    });
    const ranked = await service.rank('task-1');
    expect(ranked[0].platformRecommended).toBe(false);
  });

  it('服务类错误实例断言（ContractError 贯通）', async () => {
    mockTasksRepo.findOne.mockResolvedValueOnce(openTask({ seatTaken: 3 }));
    await expect(
      service.submit({ taskId: 'task-1', workspaceId: 'ws-9', priceCny: 1 }),
    ).rejects.toBeInstanceOf(ContractError);
  });

  describe('submitByOwner（Owner 手动让名下 workspace 报价）', () => {
    const ownerWs = {
      id: 'ws-1',
      name: '星辰 AI 工作室',
      logoUrl: 'https://logo/1.png',
      ownerUserId: 'owner-A',
    } as unknown as Workspace;

    it('名下 workspace 报价成功（source=manual_assign + 档案快照）', async () => {
      mockWorkspacesRepo.findOne.mockResolvedValueOnce(ownerWs);
      mockTasksRepo.findOne.mockResolvedValueOnce(openTask());
      mockBidsRepo.findOne.mockResolvedValueOnce(null);
      mockBidsRepo.create.mockImplementation((v) => v);
      mockBidsRepo.save.mockImplementation((v) => ({ ...v, id: 'bid-1' }));

      const result = await service.submitByOwner({
        taskId: 'task-1',
        workspaceId: 'ws-1',
        ownerId: 'owner-A',
        priceCny: 1000,
      });
      expect(result.bid.id).toBe('bid-1');
      const created = mockBidsRepo.create.mock.calls[0][0];
      expect(created.source).toBe('manual_assign');
      expect(created.workspaceName).toBe('星辰 AI 工作室');
      expect(created.workspaceLogoUrl).toBe('https://logo/1.png');
    });

    it('workspace 不存在 → 404', async () => {
      mockWorkspacesRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.submitByOwner({
          taskId: 'task-1',
          workspaceId: 'ws-x',
          ownerId: 'owner-A',
          priceCny: 1000,
        }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('workspace 不属于该 owner → 403', async () => {
      mockWorkspacesRepo.findOne.mockResolvedValueOnce({
        ...ownerWs,
        ownerUserId: 'owner-OTHER',
      });
      await expect(
        service.submitByOwner({
          taskId: 'task-1',
          workspaceId: 'ws-1',
          ownerId: 'owner-A',
          priceCny: 1000,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });
});