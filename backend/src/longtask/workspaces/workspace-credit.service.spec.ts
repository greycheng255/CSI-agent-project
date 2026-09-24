import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkspaceCreditService } from './workspace-credit.service';
import { Workspace } from './workspace.entity';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { MarketplaceDelivery } from '../marketplace-orders/delivery.entity';
import { MarketplaceDispute } from '../disputes/dispute.entity';
import { MarketplaceTask } from '../marketplace-tasks/marketplace-task.entity';

describe('WorkspaceCreditService（信用数据自动计算落库）', () => {
  let service: WorkspaceCreditService;

  const workspacesRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };
  const ordersRepo = { find: jest.fn() };
  const deliveriesRepo = { find: jest.fn() };
  const disputesRepo = { find: jest.fn() };
  const tasksRepo = { find: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceCreditService,
        { provide: getRepositoryToken(Workspace), useValue: workspacesRepo },
        { provide: getRepositoryToken(MarketplaceOrder), useValue: ordersRepo },
        { provide: getRepositoryToken(MarketplaceDelivery), useValue: deliveriesRepo },
        { provide: getRepositoryToken(MarketplaceDispute), useValue: disputesRepo },
        { provide: getRepositoryToken(MarketplaceTask), useValue: tasksRepo },
      ],
    }).compile();
    service = module.get(WorkspaceCreditService);
  });

  const workspace = {
    id: 'ws-1',
    completedTasksCount: 0,
    avgRating: 0,
    onTimeRate: 0,
    disputeRate: 0,
  };

  function stubFacts(options: {
    deliveriesByOrder: Record<string, Array<Record<string, unknown>>>;
    disputedOrderIds?: string[];
    expectedDeliveryAt?: Date | null;
  }) {
    ordersRepo.find.mockResolvedValue([
      { id: 'o1', workspaceId: 'ws-1', marketplaceTaskId: 't1', deliveryStatus: 'accepted' },
      { id: 'o2', workspaceId: 'ws-1', marketplaceTaskId: 't1', deliveryStatus: 'accepted' },
      { id: 'o3', workspaceId: 'ws-1', marketplaceTaskId: 't1', deliveryStatus: 'in_accept' },
    ]);
    deliveriesRepo.find.mockResolvedValue(
      Object.entries(options.deliveriesByOrder).flatMap(([orderId, list]) =>
        list.map((d) => ({ orderId, ...d })),
      ),
    );
    disputesRepo.find.mockResolvedValue(
      (options.disputedOrderIds ?? []).map((orderId) => ({ orderId })),
    );
    tasksRepo.find.mockResolvedValue([
      {
        id: 't1',
        expectedDeliveryAt:
          options.expectedDeliveryAt === undefined
            ? new Date('2026-09-10T00:00:00Z')
            : options.expectedDeliveryAt,
      },
    ]);
  }

  it('按首次/末次交付与纠纷记录聚合四项并写回 workspace', async () => {
    workspacesRepo.findOne.mockResolvedValue({ ...workspace });
    workspacesRepo.save.mockImplementation((v) => v);
    stubFacts({
      deliveriesByOrder: {
        o1: [
          { submissionSeq: 1, status: 'accepted', submittedAt: new Date('2026-09-08T00:00:00Z') },
        ],
        o2: [
          { submissionSeq: 1, status: 'revision_requested', submittedAt: new Date('2026-09-12T00:00:00Z') },
          { submissionSeq: 2, status: 'accepted', submittedAt: new Date('2026-09-14T00:00:00Z') },
        ],
      },
      disputedOrderIds: ['o3'],
    });

    const result = await service.recompute('ws-1');
    expect(result?.changed).toBe(true);
    expect(result?.credit).toEqual({
      completedTasksCount: 2,
      avgRating: 4.25, // 首次通过 5 + 修订后通过 3.5
      onTimeRate: 0.5, // o1 按时、o2 逾期
      disputeRate: 0.3333, // 3 单中 1 单有纠纷
    });
    expect(workspacesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ws-1',
        completedTasksCount: 2,
        avgRating: 4.25,
        onTimeRate: 0.5,
        disputeRate: 0.3333,
      }),
    );
  });

  it('数值无变化 → 不写库（避免每轮无谓 UPDATE）', async () => {
    workspacesRepo.findOne.mockResolvedValue({
      ...workspace,
      completedTasksCount: 2,
      avgRating: 4.25,
      onTimeRate: 0.5,
      disputeRate: 0.3333,
    });
    stubFacts({
      deliveriesByOrder: {
        o1: [{ submissionSeq: 1, status: 'accepted', submittedAt: new Date('2026-09-08T00:00:00Z') }],
        o2: [
          { submissionSeq: 1, status: 'revision_requested', submittedAt: new Date('2026-09-12T00:00:00Z') },
          { submissionSeq: 2, status: 'accepted', submittedAt: new Date('2026-09-14T00:00:00Z') },
        ],
      },
      disputedOrderIds: ['o3'],
    });

    const result = await service.recompute('ws-1');
    expect(result?.changed).toBe(false);
    expect(workspacesRepo.save).not.toHaveBeenCalled();
  });

  it('无订单的 workspace → 全 0（清理历史手工播种数据）', async () => {
    workspacesRepo.findOne.mockResolvedValue({
      ...workspace,
      completedTasksCount: 12,
      avgRating: 4.7,
      onTimeRate: 0.93,
      disputeRate: 0.02,
    });
    workspacesRepo.save.mockImplementation((v) => v);
    ordersRepo.find.mockResolvedValue([]);

    const result = await service.recompute('ws-1');
    expect(result?.changed).toBe(true);
    expect(result?.credit).toEqual({
      completedTasksCount: 0,
      avgRating: 0,
      onTimeRate: 0,
      disputeRate: 0,
    });
    // 无订单时不触发交付/纠纷/任务查询
    expect(deliveriesRepo.find).not.toHaveBeenCalled();
  });

  it('workspace 不存在 → 返回 null，不写库', async () => {
    workspacesRepo.findOne.mockResolvedValue(null);
    await expect(service.recompute('missing')).resolves.toBeNull();
    expect(workspacesRepo.save).not.toHaveBeenCalled();
  });

  it('recomputeAll 统计发生变更的 workspace 数量', async () => {
    workspacesRepo.find.mockResolvedValue([{ id: 'ws-1' }, { id: 'ws-2' }]);
    workspacesRepo.findOne
      .mockResolvedValueOnce({ ...workspace })
      .mockResolvedValueOnce({ ...workspace, completedTasksCount: 0, avgRating: 0, onTimeRate: 0, disputeRate: 0 });
    workspacesRepo.save.mockImplementation((v) => v);
    ordersRepo.find.mockResolvedValueOnce([
      { id: 'o1', workspaceId: 'ws-1', marketplaceTaskId: 't1', deliveryStatus: 'accepted' },
    ]);
    ordersRepo.find.mockResolvedValueOnce([]);
    deliveriesRepo.find.mockResolvedValue([]);
    disputesRepo.find.mockResolvedValue([]);
    tasksRepo.find.mockResolvedValue([{ id: 't1', expectedDeliveryAt: null }]);

    await expect(service.recomputeAll()).resolves.toBe(1);
  });
});