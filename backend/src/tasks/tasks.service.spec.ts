import { TasksService } from './tasks.service';
import { Task, TaskStatus } from './entities/task.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { BidStatus } from '../bids/entities/bid.entity';

const now = new Date('2026-06-23T08:00:00Z');

function createListQb(tasks: Task[], total = tasks.length) {
  const qb = {
    leftJoinAndSelect: jest.fn(() => qb),
    leftJoin: jest.fn(() => qb),
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    distinct: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    skip: jest.fn(() => qb),
    take: jest.fn(() => qb),
    getManyAndCount: jest.fn(async () => [tasks, total]),
  };
  return qb;
}

function createRawQb<T>(rows: T) {
  const qb = {
    select: jest.fn(() => qb),
    addSelect: jest.fn(() => qb),
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    groupBy: jest.fn(() => qb),
    getRawMany: jest.fn(async () => rows),
    getRawOne: jest.fn(async () => rows),
  };
  return qb;
}

function createTask(id: string, status: TaskStatus): Task {
  return {
    id,
    title: `Task ${id}`,
    description: `Description ${id}`,
    acceptanceCriteria: null,
    budgetCny: 1000,
    expectedDeliveryAt: now,
    tags: ['frontend'],
    skillsRequired: ['react'],
    attachmentUrls: null,
    status,
    clientUserId: 'client-001',
    client: { id: 'client-001', phone: '13800000000' } as any,
    bids: [],
    orders: [],
    createdAt: now,
    updatedAt: now,
  } as Task;
}

function createOrder(
  task: Task,
  status: OrderStatus,
  amountCny = 880,
): Order {
  return {
    id: `order-${task.id}-${status}`,
    task,
    bid: {
      id: `bid-${task.id}`,
      status: BidStatus.ACCEPTED,
      priceCny: amountCny,
      agent: { id: 'agent-001', name: 'HiClaw Agent' },
    },
    amountCny,
    status,
    createdAt: now,
    updatedAt: now,
  } as Order;
}

describe('TasksService market queries', () => {
  let service: TasksService;
  let tasksRepository: any;
  let ordersRepository: any;
  let bidsRepository: any;
  let agentsRepository: any;

  beforeEach(() => {
    tasksRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };
    ordersRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };
    bidsRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
    };
    agentsRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
    };

    service = new TasksService(
      tasksRepository,
      ordersRepository,
      bidsRepository,
      agentsRepository,
      { findOne: jest.fn() } as any,
      { findOne: jest.fn(), save: jest.fn(), create: jest.fn() } as any,
      { matchTask: jest.fn(async () => []) } as any,
      { rank: jest.fn((bids) => bids) } as any,
    );
  });

  function prepareQuery(params: {
    tasks: Task[];
    orders?: Order[];
    activeBidStats?: Array<{
      taskId: string;
      count: string;
      minPrice: string | null;
    }>;
    totalBidStats?: Array<{ taskId: string; count: string }>;
  }) {
    tasksRepository.createQueryBuilder.mockReturnValue(
      createListQb(params.tasks),
    );
    bidsRepository.createQueryBuilder
      .mockReturnValueOnce(createRawQb(params.activeBidStats || []))
      .mockReturnValueOnce(createRawQb(params.totalBidStats || []));
    agentsRepository.createQueryBuilder.mockReturnValue(
      createRawQb({ cnt: '3' }),
    );
    ordersRepository.find.mockResolvedValue(params.orders || []);
  }

  it('keeps the MCP open scan query restricted to OPEN tasks', async () => {
    const openTask = createTask('open-001', TaskStatus.OPEN);
    prepareQuery({ tasks: [openTask] });

    const result = await service.findOpenMarketTasks({ page: 1, limit: 20 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(openTask.id);
    expect(tasksRepository.createQueryBuilder().where).toHaveBeenCalledWith(
      'task.status = :status',
      { status: TaskStatus.OPEN },
    );
  });

  it('shows bidding tasks with active quote counts in the market display query', async () => {
    const task = createTask('open-quote', TaskStatus.OPEN);
    prepareQuery({
      tasks: [task],
      activeBidStats: [{ taskId: task.id, count: '1', minPrice: '700' }],
      totalBidStats: [{ taskId: task.id, count: '1' }],
    });

    const result = await service.findMarketTasks({ statusGroup: 'bidding' });
    const item = result.data[0];

    expect(item.marketStatus).toBe('OPEN_FOR_BIDDING');
    expect(item.marketStatusLabel).toBe('招标中');
    expect(item.isAcceptingBids).toBe(true);
    expect(item.bidsCount).toBe(1);
    expect(item.latestBid).toBe(700);
  });

  it.each([
    [OrderStatus.PENDING_PAYMENT, 'AWARDED_PENDING_PAYMENT', '已中标，待支付'],
    [OrderStatus.IN_PROGRESS, 'IN_PROGRESS', '执行中'],
    [OrderStatus.DELIVERED, 'WAITING_ACCEPTANCE', '已交付，待验收'],
    [OrderStatus.COMPLETED, 'COMPLETED', '已完成'],
    [OrderStatus.CANCELED, 'CANCELED', '已取消'],
    [OrderStatus.REFUNDED, 'REFUNDED', '已退款'],
    [OrderStatus.ARBITRATING, 'ARBITRATING', '仲裁中'],
  ])(
    'shows %s orders as %s in the market display query',
    async (orderStatus, marketStatus, label) => {
      const task = createTask(`closed-${orderStatus}`, TaskStatus.CLOSED);
      const order = createOrder(task, orderStatus);
      prepareQuery({
        tasks: [task],
        orders: [order],
        totalBidStats: [{ taskId: task.id, count: '2' }],
      });

      const result = await service.findMarketTasks({ statusGroup: 'all' });
      const item = result.data[0];

      expect(item.marketStatus).toBe(marketStatus);
      expect(item.marketStatusLabel).toBe(label);
      expect(item.isAcceptingBids).toBe(false);
      expect(item.orderId).toBe(order.id);
      expect(item.orderStatus).toBe(orderStatus);
      expect(item.selectedAgent?.id).toBe('agent-001');
      expect(item.dealPriceCny).toBe(880);
      expect(item.totalBidsCount).toBe(2);
    },
  );
});
