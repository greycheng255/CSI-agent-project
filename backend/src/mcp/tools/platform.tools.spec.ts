import { MCPToolsProvider } from './platform.tools';
import { BidStatus } from '../../bids/entities/bid.entity';
import { DeliveryStatus } from '../../orders/entities/delivery.entity';
import { OrderStatus } from '../../orders/entities/order.entity';
import { TaskStatus } from '../../tasks/entities/task.entity';
import {
  MCPAgentTaskEvent,
  MCPAgentTaskEventStatus,
  MCPAgentTaskEventType,
} from '../entities/mcp-agent-task-event.entity';

const now = new Date('2026-06-22T10:00:00Z');

function createRepo<T>() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    save: jest.fn(async (item: T) => item),
  };
}

function createHiClawWorkflowFixture() {
  const agent = {
    id: 'agent-uuid',
    externalId: 'agent-001',
    owner: { id: 'owner-001' },
  };
  const task = {
    id: 'task-001',
    title: '开发 React 后台管理面板',
    description: '需要开发一个包含用户管理、权限控制、数据看板的 React 后台',
    skillsRequired: ['react', 'typescript', 'antd'],
    tags: ['frontend'],
    budgetCny: 500,
    expectedDeliveryAt: new Date('2026-07-15T00:00:00Z'),
    clientUserId: 'client-001',
    client: { id: 'client-001' },
    status: TaskStatus.OPEN,
    attachmentUrls: ['https://platform.example.com/files/requirements.pdf'],
    createdAt: now,
    updatedAt: now,
    bidsCount: 0,
  };
  const state: {
    bid: any;
    order: any;
    delivery: any;
    events: MCPAgentTaskEvent[];
    executionProgress: number;
  } = {
    bid: null,
    order: null,
    delivery: null,
    events: [],
    executionProgress: 0,
  };

  const agentsDiscoveryService = { discover: jest.fn() };
  const agentsHealthService = { recordHeartbeat: jest.fn() };
  const tasksService = {
    findOpenMarketTasks: jest.fn(async () => ({
      data: [{ ...task, bidsCount: state.bid ? 1 : 0 }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    })),
    findOne: jest.fn(async (id: string) => (id === task.id ? task : null)),
    findBids: jest.fn(async () => (state.bid ? [state.bid] : [])),
  };
  const ordersService = {
    findOne: jest.fn(async () => state.order),
    deliver: jest.fn(
      async (orderId: string, ownerUserId: string, data: any) => {
        state.delivery = {
          id: 'delivery-001',
          orderId,
          ownerUserId,
          status: DeliveryStatus.PENDING_REVIEW,
          deliveryText: data.deliverySummary,
          attachmentUrl: data.deliveryUrl || null,
          artifactUrls: data.artifactUrls || null,
          rejectionReason: null,
          rejectedAt: null,
        };
        state.order.status = OrderStatus.DELIVERED;
        state.order.currentDeliveryId = state.delivery.id;
        state.order.deliverySummary = data.deliverySummary;
        state.order.deliveryUrl = data.deliveryUrl || null;
        return { order: state.order, delivery: state.delivery };
      },
    ),
  };
  const bidsService = {
    create: jest.fn(async (data: any) => {
      state.bid = {
        id: 'bid-001',
        task,
        agent,
        priceCny: data.priceCny,
        planSummary: data.planSummary,
        status: BidStatus.SUBMITTED,
        createdAt: now,
        updatedAt: now,
      };
      return state.bid;
    }),
  };
  const executionService = {
    reportProgress: jest.fn(async (data: any) => {
      state.executionProgress = data.progress;
    }),
    getExecutionProgress: jest.fn(async () => ({
      totalProgress: state.executionProgress,
      status: 'RUNNING',
      phases: [],
      traces: [],
    })),
  };

  const agentsRepository = createRepo();
  const tasksRepository = createRepo();
  const bidsRepository = createRepo<any>();
  const ordersRepository = createRepo<any>();
  const deliveriesRepository = createRepo<any>();
  const phasesRepository = createRepo();
  const taskEventsRepository = createRepo<MCPAgentTaskEvent>();
  const arbitrationsRepository = createRepo<any>();

  bidsRepository.findOne.mockImplementation(async () => state.bid);
  bidsRepository.count.mockImplementation(async () => (state.bid ? 1 : 0));
  ordersRepository.findOne.mockImplementation(async (query: any) => {
    if (!state.order) return null;
    const orderId = query?.where?.id;
    const taskId = query?.where?.task?.id;
    const agentId = query?.where?.bid?.agent?.id;
    if (orderId && orderId !== state.order.id) return null;
    if (taskId && taskId !== task.id) return null;
    if (agentId && agentId !== agent.id) return null;
    return state.order;
  });
  ordersRepository.find.mockImplementation(async () =>
    state.order ? [state.order] : [],
  );
  deliveriesRepository.findOne.mockImplementation(async (query: any) => {
    if (!state.delivery) return null;
    const id = query?.where?.id;
    const status = query?.where?.status;
    if (id && id !== state.delivery.id) return null;
    if (status && status !== state.delivery.status) return null;
    return state.delivery;
  });
  taskEventsRepository.findOne.mockImplementation(async (query: any) => {
    const where = query?.where || {};
    return (
      state.events.find((event) => {
        if (where.id && event.id !== where.id) return false;
        if (where.agentId && event.agentId !== where.agentId) return false;
        if (where.eventType && event.eventType !== where.eventType)
          return false;
        if (where.eventKey && event.eventKey !== where.eventKey) return false;
        return true;
      }) || null
    );
  });
  taskEventsRepository.find.mockImplementation(async (query: any) => {
    const where = query?.where || {};
    const statusFilter = where.status;
    const statuses: string[] | undefined = Array.isArray(statusFilter)
      ? statusFilter
      : Array.isArray(statusFilter?._value)
        ? statusFilter._value
        : undefined;
    return state.events.filter((event) => {
      if (where.agentId && event.agentId !== where.agentId) return false;
      if (statuses && !statuses.includes(event.status)) return false;
      return true;
    });
  });
  taskEventsRepository.save.mockImplementation(
    async (event: MCPAgentTaskEvent) => {
      const existingIndex = state.events.findIndex(
        (item) => item.id === event.id,
      );
      const saved = {
        ...event,
        id: event.id || `event-${state.events.length + 1}`,
        createdAt: event.createdAt || now,
        updatedAt: now,
      } as MCPAgentTaskEvent;
      if (existingIndex >= 0) {
        state.events[existingIndex] = saved;
      } else {
        state.events.push(saved);
      }
      return saved;
    },
  );
  arbitrationsRepository.findOne.mockImplementation(async () => null);

  const provider = new MCPToolsProvider(
    agentsDiscoveryService as any,
    agentsHealthService as any,
    tasksService as any,
    ordersService as any,
    bidsService as any,
    executionService as any,
    agentsRepository as any,
    tasksRepository as any,
    bidsRepository as any,
    ordersRepository as any,
    deliveriesRepository as any,
    phasesRepository as any,
    taskEventsRepository as any,
    arbitrationsRepository as any,
  );
  const tools = new Map(provider.getTools().map((tool) => [tool.name, tool]));
  const ctx = {
    caller: 'hiclaw-controller',
    agentId: agent.id,
    agentExternalId: agent.externalId,
    ownerUserId: agent.owner.id,
  };

  return {
    state,
    task,
    agent,
    tools,
    ctx,
    acceptBid() {
      state.bid.status = BidStatus.ACCEPTED;
      state.order = {
        id: 'order-001',
        task,
        bid: state.bid,
        status: OrderStatus.IN_PROGRESS,
        ownerUserId: agent.owner.id,
        owner: agent.owner,
        currentDeliveryId: null,
        disputeReason: null,
        createdAt: now,
        updatedAt: now,
        acceptedAt: null,
        releasedAt: null,
      };
    },
    requestRevision(reason: string) {
      state.order.status = OrderStatus.IN_PROGRESS;
      state.order.disputeReason = reason;
      state.delivery.status = DeliveryStatus.REJECTED;
      state.delivery.rejectionReason = reason;
      state.delivery.rejectedAt = now;
    },
    completeOrder() {
      state.order.status = OrderStatus.COMPLETED;
      state.order.releasedAt = now;
      state.delivery.status = DeliveryStatus.ACCEPTED;
      state.delivery.acceptedAt = now;
    },
  };
}

describe('MCPToolsProvider HiClaw workflow', () => {
  it('supports quote, accepted task, progress, delivery, revision, and completion', async () => {
    const fx = createHiClawWorkflowFixture();

    const listOpen = await fx.tools
      .get('platform.task.list_open')!
      .execute({ skills: ['react'], page: 1, pageSize: 20 }, fx.ctx);
    expect((listOpen.data as any).tasks[0].taskId).toBe(fx.task.id);
    expect((listOpen.data as any).tasks[0].events[0].eventType).toBe(
      MCPAgentTaskEventType.TASK_RECOMMENDED,
    );
    expect((listOpen.data as any).tasks[0].events[0].shouldAct).toBe(true);

    const detail = await fx.tools
      .get('platform.task.get')!
      .execute({ taskId: fx.task.id }, fx.ctx);
    expect((detail.data as any).attachments[0].url).toContain(
      'requirements.pdf',
    );

    const quote = await fx.tools.get('platform.quote.submit')!.execute(
      {
        taskId: fx.task.id,
        agentId: fx.agent.externalId,
        priceCny: 150,
        planSummary: 'React + Vite + Antd 方案',
      },
      fx.ctx,
    );
    expect((quote.data as any).status).toBe('PENDING');

    const duplicate = await fx.tools
      .get('platform.quote.submit')!
      .execute({ taskId: fx.task.id, priceCny: 150 }, fx.ctx);
    expect(duplicate.success).toBe(false);
    expect(duplicate.error?.code).toBe('DUPLICATE_BID');

    const pendingBid = await fx.tools
      .get('platform.quote.get_my')!
      .execute({ taskId: fx.task.id }, fx.ctx);
    expect((pendingBid.data as any).status).toBe('PENDING');
    expect((pendingBid.data as any).orderId).toBeNull();
    expect((pendingBid.data as any).events[0].eventType).toBe(
      MCPAgentTaskEventType.BID_SUBMITTED,
    );
    expect((pendingBid.data as any).events[0].shouldAct).toBe(true);

    fx.acceptBid();

    const acceptedBid = await fx.tools
      .get('platform.quote.get_my')!
      .execute({ taskId: fx.task.id }, fx.ctx);
    expect((acceptedBid.data as any).status).toBe('ACCEPTED');
    expect((acceptedBid.data as any).orderId).toBe(fx.state.order.id);
    expect((acceptedBid.data as any).events[0].eventType).toBe(
      MCPAgentTaskEventType.BID_ACCEPTED,
    );
    expect((acceptedBid.data as any).events[0].shouldAct).toBe(true);

    const myTasks = await fx.tools
      .get('platform.order.list_my')!
      .execute({}, fx.ctx);
    expect((myTasks.data as any).tasks[0].status).toBe('IN_PROGRESS');
    expect(
      (myTasks.data as any).tasks[0].events.find(
        (event: any) => event.eventType === MCPAgentTaskEventType.BID_ACCEPTED,
      ).shouldAct,
    ).toBe(false);
    expect(
      (myTasks.data as any).tasks[0].events.find(
        (event: any) => event.eventType === MCPAgentTaskEventType.ORDER_STARTED,
      ).shouldAct,
    ).toBe(true);

    const progress = await fx.tools
      .get('platform.order.update_execution')!
      .execute(
        {
          taskId: fx.task.id,
          phase: '核心开发',
          progress: 65,
          message: '核心功能已完成',
        },
        fx.ctx,
      );
    expect((progress.data as any).orderId).toBe(fx.state.order.id);
    expect((progress.data as any).progress).toBe(65);
    expect((progress.data as any).execution.totalProgress).toBe(65);

    const delivery = await fx.tools.get('platform.artifact.attach')!.execute(
      {
        taskId: fx.task.id,
        url: 'https://preview.example.com/artifact.zip',
        resultSummary: '已完成管理后台开发',
        previewUrl: 'https://preview.example.com/task-001',
      },
      fx.ctx,
    );
    expect((delivery.data as any).orderId).toBe(fx.state.order.id);
    expect((delivery.data as any).deliveryId).toBe('delivery-001');
    expect((delivery.data as any).artifactUrls).toContain(
      'https://preview.example.com/artifact.zip',
    );
    expect((delivery.data as any).status).toBe('WAITING_ACCEPTANCE');

    const waiting = await fx.tools
      .get('platform.task.get_status')!
      .execute({ taskId: fx.task.id }, fx.ctx);
    expect((waiting.data as any).status).toBe('WAITING_ACCEPTANCE');
    expect((waiting.data as any).hiclawStatus).toBe('WAITING_ACCEPTANCE');

    fx.requestRevision('分页功能有 Bug');

    const revision = await fx.tools
      .get('platform.task.get_status')!
      .execute({ taskId: fx.task.id }, fx.ctx);
    expect((revision.data as any).status).toBe('REVISION_REQUESTED');
    expect((revision.data as any).hiclawStatus).toBe('REVISION_REQUESTED');
    expect((revision.data as any).revisionReason).toContain('分页');
    expect(
      (revision.data as any).events.find(
        (event: any) =>
          event.eventType === MCPAgentTaskEventType.REVISION_REQUESTED,
      ).shouldAct,
    ).toBe(true);

    const repeatedRevision = await fx.tools
      .get('platform.task.get_status')!
      .execute({ taskId: fx.task.id }, fx.ctx);
    expect(
      (repeatedRevision.data as any).events.find(
        (event: any) =>
          event.eventType === MCPAgentTaskEventType.REVISION_REQUESTED,
      ).shouldAct,
    ).toBe(false);

    await fx.tools.get('platform.artifact.attach')!.execute(
      {
        taskId: fx.task.id,
        resultSummary: '已修复分页问题',
        revision: true,
      },
      fx.ctx,
    );
    fx.completeOrder();

    const completed = await fx.tools
      .get('platform.task.get_status')!
      .execute({ taskId: fx.task.id }, fx.ctx);
    expect((completed.data as any).status).toBe('COMPLETED');
    expect((completed.data as any).hiclawStatus).toBe('COMPLETED');
    expect((completed.data as any).progress.percent).toBe(100);
    expect(
      (completed.data as any).events.find(
        (event: any) =>
          event.eventType === MCPAgentTaskEventType.ORDER_COMPLETED,
      ).shouldAct,
    ).toBe(true);
    expect(
      (completed.data as any).events.find(
        (event: any) =>
          event.eventType === MCPAgentTaskEventType.DELIVERY_ACCEPTED,
      ).shouldAct,
    ).toBe(true);
  });

  it('consumes accepted order notifications once and acks them through platform.event.ack', async () => {
    const fx = createHiClawWorkflowFixture();

    await fx.tools.get('platform.quote.submit')!.execute(
      {
        taskId: fx.task.id,
        priceCny: 150,
        planSummary: 'React + Vite + Antd 方案',
      },
      fx.ctx,
    );
    fx.acceptBid();

    const firstPoll = await fx.tools
      .get('platform.order.list_my')!
      .execute({}, fx.ctx);
    const firstAcceptedEvent = (firstPoll.data as any).tasks[0].events.find(
      (event: any) => event.eventType === MCPAgentTaskEventType.BID_ACCEPTED,
    );
    expect(firstAcceptedEvent.shouldAct).toBe(true);
    expect(firstAcceptedEvent.noticeStatus).toBe(
      MCPAgentTaskEventStatus.DELIVERED,
    );

    const secondPoll = await fx.tools
      .get('platform.order.list_my')!
      .execute({}, fx.ctx);
    const secondAcceptedEvent = (secondPoll.data as any).tasks[0].events.find(
      (event: any) => event.eventType === MCPAgentTaskEventType.BID_ACCEPTED,
    );
    expect(secondAcceptedEvent.shouldAct).toBe(false);

    const ack = await fx.tools.get('platform.event.ack')!.execute(
      {
        eventId: firstAcceptedEvent.eventId,
        taskId: fx.task.id,
        orderId: fx.state.order.id,
        idempotency_key: `hiclaw-event-ack-${firstAcceptedEvent.eventId}`,
      },
      fx.ctx,
    );
    expect((ack.data as any).noticeStatus).toBe(MCPAgentTaskEventStatus.ACKED);

    const repeatedAck = await fx.tools.get('platform.event.ack')!.execute(
      {
        eventId: firstAcceptedEvent.eventId,
        idempotency_key: `hiclaw-event-ack-repeat-${firstAcceptedEvent.eventId}`,
      },
      fx.ctx,
    );
    expect((repeatedAck.data as any).noticeStatus).toBe(
      MCPAgentTaskEventStatus.ACKED,
    );

    const afterAck = await fx.tools
      .get('platform.order.list_my')!
      .execute({}, fx.ctx);
    const ackedAcceptedEvent = (afterAck.data as any).tasks[0].events.find(
      (event: any) => event.eventType === MCPAgentTaskEventType.BID_ACCEPTED,
    );
    expect(ackedAcceptedEvent.shouldAct).toBe(false);
    expect(ackedAcceptedEvent.noticeStatus).toBe(MCPAgentTaskEventStatus.ACKED);
  });
});
