import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SelectionService } from './selection.service';
import { MarketplaceBid } from './marketplace-bid.entity';
import { MarketplaceTask } from '../marketplace-tasks/marketplace-task.entity';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';

describe('SelectionService（T10：选标/全部驳回/72h 自动驳回）', () => {
  let service: SelectionService;

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
  const mockOrdersRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };
  const mockDispatcher = { enqueue: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SelectionService,
        { provide: getRepositoryToken(MarketplaceBid), useValue: mockBidsRepo },
        {
          provide: getRepositoryToken(MarketplaceTask),
          useValue: mockTasksRepo,
        },
        {
          provide: getRepositoryToken(MarketplaceOrder),
          useValue: mockOrdersRepo,
        },
        {
          provide: WebhookDispatcherService,
          useValue: mockDispatcher,
        },
      ],
    }).compile();
    service = module.get(SelectionService);
  });

  function openTask(overrides: Partial<MarketplaceTask> = {}) {
    return {
      id: 'task-1',
      status: 'open',
      bidRound: 1,
      seatTaken: 2,
      seatLimit: 5,
      employerUserId: 'emp-1',
      ...overrides,
    } as MarketplaceTask;
  }

  it('选标：win=won、同轮其余=lost、任务→selected、建 Order、发 bid.won', async () => {
    mockTasksRepo.findOne.mockResolvedValue(openTask());
    mockBidsRepo.findOne.mockResolvedValueOnce({
      id: 'bid-win',
      marketplaceTaskId: 'task-1',
      bidRound: 1,
      workspaceId: 'ws-1',
      priceCny: 800,
      status: 'submitted',
    } as MarketplaceBid);
    mockBidsRepo.find.mockResolvedValueOnce([
      {
        id: 'bid-lose',
        marketplaceTaskId: 'task-1',
        bidRound: 1,
        workspaceId: 'ws-2',
      },
    ] as MarketplaceBid[]);
    mockOrdersRepo.create.mockImplementation((v) => v);
    mockOrdersRepo.save.mockImplementation((v) => v);

    const order = await service.selectBid('task-1', 'bid-win');
    expect(order.workspaceId).toBe('ws-1');
    expect(order.contractStatus).toBe('signing');
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'bid.won',
      expect.stringContaining('/v1/webhooks/bid/result'),
      expect.objectContaining({
        event_type: 'bid.won',
        marketplace_task_id: 'task-1',
        workspace_id: 'ws-1',
        order_id: order.id,
        bid_round: 1,
      }),
    );
  });

  it('选标：竞标不属于当前轮 → 422', async () => {
    mockTasksRepo.findOne.mockResolvedValue(openTask());
    mockBidsRepo.findOne.mockResolvedValueOnce({
      id: 'bid-old',
      marketplaceTaskId: 'task-1',
      bidRound: 2, // 上一轮
      workspaceId: 'ws-1',
      status: 'submitted',
    } as MarketplaceBid);
    await expect(service.selectBid('task-1', 'bid-old')).rejects.toMatchObject({
      status: 422,
    });
  });

  it('全部驳回：submitted→rejected、任务重开 round+1 席位清零、发 batch_rejected', async () => {
    mockTasksRepo.findOne.mockResolvedValue(openTask({ seatTaken: 3 }));
    mockBidsRepo.find.mockResolvedValueOnce([
      {
        id: 'b1',
        marketplaceTaskId: 'task-1',
        bidRound: 1,
        workspaceId: 'ws-1',
        status: 'submitted',
      },
      {
        id: 'b2',
        marketplaceTaskId: 'task-1',
        bidRound: 1,
        workspaceId: 'ws-2',
        status: 'submitted',
      },
    ] as MarketplaceBid[]);

    const result = await service.rejectAll('task-1');
    expect(result.rejectedCount).toBe(2);
    // bids 走 bidsRepo.save、任务重开走 tasksRepo.save（首个调用即任务）
    const savedTask = mockTasksRepo.save.mock.calls[0][0];
    expect(savedTask.status).toBe('open');
    expect(savedTask.bidRound).toBe(2);
    expect(savedTask.seatTaken).toBe(0);
    expect(savedTask.seatFullDeadline).toBeNull();
    expect(savedTask.lastReopenedAt).not.toBeNull();
    // 每个受影响 workspace 一个 event
    expect(mockDispatcher.enqueue).toHaveBeenCalledTimes(2);
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'bid.batch_rejected',
      expect.any(String),
      expect.objectContaining({ workspace_id: 'ws-1', bid_round: 1 }),
    );
  });

  it('72h 席位满超时 → 自动全部驳回', async () => {
    mockTasksRepo.find.mockResolvedValueOnce([
      { id: 'task-a' },
      { id: 'task-b' },
    ] as MarketplaceTask[]);
    mockTasksRepo.findOne.mockImplementation(async ({ where }) =>
      openTask({ id: where.id } as Partial<MarketplaceTask>),
    );
    mockBidsRepo.find.mockResolvedValue([]);

    const count = await service.scanSeatFullTimeouts(new Date());
    expect(count).toBe(2);
  });

  it('非 open 任务选标 → 422', async () => {
    mockTasksRepo.findOne.mockResolvedValue(
      openTask({ status: 'selected' }),
    );
    await expect(service.selectBid('task-1', 'b')).rejects.toMatchObject({
      status: 422,
    });
  });
});