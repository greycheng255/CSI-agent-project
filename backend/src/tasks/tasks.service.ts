import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task, TaskStatus } from './entities/task.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { Bid, BidStatus } from '../bids/entities/bid.entity';
import { Agent } from '../agents/entities/agent.entity';
import { User } from '../users/entities/user.entity';
import {
  WebhookDelivery,
  WebhookDeliveryStatus,
} from '../webhooks/entities/webhook-delivery.entity';
import { TasksMatchingService } from './tasks-matching.service';
import { BidsRankingService } from '../bids/bids-ranking.service';

export type TaskSearchFilters = {
  keyword?: string;
  minBudget?: number;
  maxBudget?: number;
  tags?: string[];
  sortBy?: 'newest' | 'budget_desc' | 'budget_asc';
  statusGroup?: MarketStatusGroup;
  page?: number;
  limit?: number;
};

export type MarketStatusGroup =
  | 'all'
  | 'bidding'
  | 'executing'
  | 'completed'
  | 'abnormal';

export type MarketStatus =
  | 'OPEN_FOR_BIDDING'
  | 'AWARDED_PENDING_PAYMENT'
  | 'IN_PROGRESS'
  | 'WAITING_ACCEPTANCE'
  | 'PENDING_RELEASE'
  | 'COMPLETED'
  | 'REJECTED'
  | 'ARBITRATING'
  | 'REFUNDED'
  | 'CANCELED'
  | 'CLOSED_NO_AWARD';

type TaskWithMarketMeta = Task & {
  bidsCount?: number;
  totalBidsCount?: number;
  latestBid?: number | null;
  matchedAgents?: number;
  marketStatus?: MarketStatus;
  marketStatusLabel?: string;
  isAcceptingBids?: boolean;
  orderId?: string | null;
  orderStatus?: OrderStatus | null;
  selectedAgent?: { id: string; name?: string | null } | null;
  dealPriceCny?: number | null;
};

type MarketOrderSummary = {
  id: string;
  taskId: string;
  status: OrderStatus;
  amountCny: number;
  bidPriceCny: number | null;
  agentId: string | null;
  agentName: string | null;
};

type MarketTaskPage = {
  data: TaskWithMarketMeta[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

type CreateTaskDto = {
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  budgetCny: number;
  expectedDeliveryAt?: string;
  clientUserId?: string;
  tags?: string[];
  skillsRequired?: string[];
  attachmentUrls?: string[];
};

type SelectBidDto = {
  bidId: string;
  userId: string;
};

type UpdateTaskDto = {
  title?: string;
  description?: string;
  acceptanceCriteria?: string;
  budgetCny?: number;
  expectedDeliveryAt?: string | null;
  tags?: string[];
  skillsRequired?: string[];
  attachmentUrls?: string[];
  userId: string;
};

@Injectable()
export class TasksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TasksService.name);
  private readonly legacyTaskWebhooksEnabled =
    process.env.LEGACY_TASK_WEBHOOKS_ENABLED === 'true';
  private availableAgentCountCache:
    | { value: number; expiresAt: number }
    | undefined;
  private availableAgentCountRequest: Promise<number> | undefined;
  private readonly marketResultCache = new Map<
    string,
    {
      value: MarketTaskPage;
      expiresAt: number;
      staleUntil: number;
    }
  >();
  private readonly marketResultRequests = new Map<
    string,
    Promise<MarketTaskPage>
  >();
  private readonly marketCacheTtlMs = 30_000;
  private readonly marketCacheStaleMs = 5 * 60_000;

  constructor(
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    @InjectRepository(Bid)
    private bidsRepository: Repository<Bid>,
    @InjectRepository(Agent)
    private agentsRepository: Repository<Agent>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(WebhookDelivery)
    private webhookDeliveriesRepository: Repository<WebhookDelivery>,
    private tasksMatchingService: TasksMatchingService,
    private bidsRankingService: BidsRankingService,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.TASK_MARKET_PRELOAD === 'false') return;

    const startedAt = Date.now();
    try {
      await this.findMarketTasks({
        sortBy: 'newest',
        statusGroup: 'all',
        page: 1,
        limit: 50,
      });
      this.logger.log(
        `Task market cache preloaded in ${Date.now() - startedAt}ms`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Task market cache preload skipped: ${message}`);
    }
  }

  private normalizeList(values?: unknown) {
    if (!Array.isArray(values)) return null;
    const normalized = Array.from(
      new Set(
        values
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );
    return normalized.length > 0 ? normalized : null;
  }

  private marketCacheKey(filters?: TaskSearchFilters) {
    return JSON.stringify({
      keyword: filters?.keyword?.trim() || '',
      minBudget: filters?.minBudget ?? null,
      maxBudget: filters?.maxBudget ?? null,
      tags: [...(filters?.tags || [])].sort(),
      sortBy: filters?.sortBy || 'newest',
      statusGroup: filters?.statusGroup || 'all',
      page: filters?.page || 1,
      limit: filters?.limit || 20,
    });
  }

  private invalidateMarketCache() {
    this.marketResultCache.clear();
  }

  private async sendWebhookWithRetry(deliveryId: string) {
    const delivery = await this.webhookDeliveriesRepository.findOne({
      where: { id: deliveryId },
      relations: ['agent'],
    });
    if (!delivery) return;
    if (delivery.status === WebhookDeliveryStatus.SUCCESS) return;

    const maxAttempts = Number(process.env.WEBHOOK_MAX_ATTEMPTS || 3);
    const timeoutMs = Number(process.env.WEBHOOK_TIMEOUT_MS || 2000);

    const attemptIndex = delivery.attempts + 1;
    delivery.attempts = attemptIndex;
    delivery.nextAttemptAt = null;
    await this.webhookDeliveriesRepository.save(delivery);

    const payload =
      delivery.payload ||
      ({
        event: 'TASK_OPEN',
        taskId: delivery.taskId,
      } as Record<string, unknown>);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(delivery.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      delivery.status = WebhookDeliveryStatus.SUCCESS;
      delivery.lastError = null;
      await this.webhookDeliveriesRepository.save(delivery);
      return;
    } catch (e) {
      delivery.lastError = String((e as Error)?.message || e);
      if (attemptIndex >= maxAttempts) {
        delivery.status = WebhookDeliveryStatus.FAILED;
        delivery.nextAttemptAt = null;
        await this.webhookDeliveriesRepository.save(delivery);
        return;
      }

      const delayMs = Math.min(60000, 1000 * 2 ** (attemptIndex - 1));
      delivery.status = WebhookDeliveryStatus.PENDING;
      delivery.nextAttemptAt = new Date(Date.now() + delayMs);
      await this.webhookDeliveriesRepository.save(delivery);
      setTimeout(() => {
        void this.sendWebhookWithRetry(delivery.id);
      }, delayMs);
    }
  }

  private async notifyAgents(task: Task) {
    if (!this.legacyTaskWebhooksEnabled) {
      console.log(
        `[MCP-FLOW] Legacy task webhook fanout disabled; task is available through MCP | taskId=${task.id}`,
      );
      return;
    }

    const matchedAgents = await this.tasksMatchingService.matchTask(task, 10);
    const targetAgents = matchedAgents.filter(
      (a) => typeof a.webhookUrl === 'string' && a.webhookUrl.length > 0,
    );

    const created = await Promise.all(
      targetAgents.map((a) =>
        this.webhookDeliveriesRepository.save(
          this.webhookDeliveriesRepository.create({
            agent: a,
            taskId: task.id,
            webhookUrl: a.webhookUrl,
            payload: {
              event: 'TASK_OPEN',
              taskId: task.id,
              taskDetails: task,
              matchScore: a.matchScore,
              matchedReasons: a.matchedReasons,
            },
            status: WebhookDeliveryStatus.PENDING,
            attempts: 0,
            lastError: null,
            nextAttemptAt: new Date(),
          }),
        ),
      ),
    );

    for (const d of created) {
      void this.sendWebhookWithRetry(d.id);
    }
  }

  async create(data: CreateTaskDto) {
    let client: User | null = null;
    if (typeof data.clientUserId === 'string' && data.clientUserId.length > 0) {
      client = await this.usersRepository.findOne({
        where: { id: data.clientUserId },
      });
    }
    const task = this.tasksRepository.create({
      title: data.title,
      description: data.description,
      acceptanceCriteria: data.acceptanceCriteria,
      budgetCny: data.budgetCny,
      expectedDeliveryAt: data.expectedDeliveryAt,
      tags: this.normalizeList(data.tags),
      skillsRequired: this.normalizeList(data.skillsRequired),
      attachmentUrls: this.normalizeList(data.attachmentUrls),
      status: TaskStatus.OPEN,
      client: client || undefined,
      clientUserId: data.clientUserId || undefined,
    });
    const saved = await this.tasksRepository.save(task);
    this.invalidateMarketCache();
    void this.notifyAgents(saved);
    return saved;
  }

  private applyMarketFilters(
    qb: ReturnType<Repository<Task>['createQueryBuilder']>,
    filters?: TaskSearchFilters,
  ) {
    if (filters?.keyword) {
      qb.andWhere(
        '(task.title LIKE :keyword OR task.description LIKE :keyword)',
        { keyword: `%${filters.keyword}%` },
      );
    }

    if (filters?.minBudget !== undefined) {
      qb.andWhere('task.budgetCny >= :minBudget', {
        minBudget: filters.minBudget,
      });
    }
    if (filters?.maxBudget !== undefined) {
      qb.andWhere('task.budgetCny <= :maxBudget', {
        maxBudget: filters.maxBudget,
      });
    }

    // 标签过滤走 SQL（PostgreSQL array overlap）
    if (filters?.tags && filters.tags.length > 0) {
      qb.andWhere('task.tags && :tags', { tags: filters.tags });
    }

    return qb;
  }

  private applyMarketSort(
    qb: ReturnType<Repository<Task>['createQueryBuilder']>,
    filters?: TaskSearchFilters,
  ) {
    switch (filters?.sortBy) {
      case 'budget_desc':
        qb.orderBy('task.budgetCny', 'DESC');
        break;
      case 'budget_asc':
        qb.orderBy('task.budgetCny', 'ASC');
        break;
      default:
        qb.orderBy('task.createdAt', 'DESC');
        break;
    }
    return qb;
  }

  private marketStatusFor(
    task: Task,
    order?: Pick<MarketOrderSummary, 'status'> | null,
  ): MarketStatus {
    if (!order) {
      return task.status === TaskStatus.OPEN
        ? 'OPEN_FOR_BIDDING'
        : 'CLOSED_NO_AWARD';
    }
    switch (order.status) {
      case OrderStatus.PENDING_PAYMENT:
        return 'AWARDED_PENDING_PAYMENT';
      case OrderStatus.IN_PROGRESS:
        return 'IN_PROGRESS';
      case OrderStatus.DELIVERED:
        return 'WAITING_ACCEPTANCE';
      case OrderStatus.ACCEPTED:
      case OrderStatus.PENDING_RELEASE:
        return 'PENDING_RELEASE';
      case OrderStatus.COMPLETED:
        return 'COMPLETED';
      case OrderStatus.REJECTED:
        return 'REJECTED';
      case OrderStatus.ARBITRATING:
        return 'ARBITRATING';
      case OrderStatus.REFUNDED:
        return 'REFUNDED';
      case OrderStatus.CANCELED:
        return 'CANCELED';
      default:
        return 'IN_PROGRESS';
    }
  }

  private marketStatusLabel(status: MarketStatus) {
    const labels: Record<MarketStatus, string> = {
      OPEN_FOR_BIDDING: '招标中',
      AWARDED_PENDING_PAYMENT: '已中标，待支付',
      IN_PROGRESS: '执行中',
      WAITING_ACCEPTANCE: '已交付，待验收',
      PENDING_RELEASE: '验收通过，待放款',
      COMPLETED: '已完成',
      REJECTED: '验收驳回',
      ARBITRATING: '仲裁中',
      REFUNDED: '已退款',
      CANCELED: '已取消',
      CLOSED_NO_AWARD: '已关闭',
    };
    return labels[status];
  }

  private async getAvailableAgentCount() {
    const now = Date.now();
    if (
      this.availableAgentCountCache &&
      this.availableAgentCountCache.expiresAt > now
    ) {
      return this.availableAgentCountCache.value;
    }
    if (this.availableAgentCountRequest) {
      return this.availableAgentCountRequest;
    }

    this.availableAgentCountRequest = this.agentsRepository
      .createQueryBuilder('agent')
      .select('COUNT(agent.id)', 'cnt')
      .where('agent.approvalStatus = :approved', { approved: 'approved' })
      .andWhere('agent.isActive = :active', { active: true })
      .andWhere('agent.runtimeStatus IN (:...statuses)', {
        statuses: ['online', 'degraded'],
      })
      .getRawOne<{ cnt: string }>()
      .then((row) => {
        const value = Number.parseInt(row?.cnt || '0', 10);
        this.availableAgentCountCache = {
          value,
          expiresAt: Date.now() + 30_000,
        };
        return value;
      })
      .finally(() => {
        this.availableAgentCountRequest = undefined;
      });

    return this.availableAgentCountRequest;
  }

  private async findMarketOrderSummaries(taskIds: string[]) {
    const rows = await this.ordersRepository
      .createQueryBuilder('marketOrder')
      .innerJoin('marketOrder.task', 'marketTask')
      .leftJoin('marketOrder.bid', 'marketBid')
      .leftJoin('marketBid.agent', 'marketAgent')
      .select('marketOrder.id', 'orderId')
      .addSelect('marketTask.id', 'taskId')
      .addSelect('marketOrder.status', 'orderStatus')
      .addSelect('marketOrder.amountCny', 'amountCny')
      .addSelect('marketBid.priceCny', 'bidPriceCny')
      .addSelect('marketAgent.id', 'agentId')
      .addSelect('marketAgent.name', 'agentName')
      .where('marketTask.id IN (:...taskIds)', { taskIds })
      .orderBy('marketOrder.createdAt', 'DESC')
      .getRawMany<{
        orderId: string;
        taskId: string;
        orderStatus: OrderStatus;
        amountCny: number | string;
        bidPriceCny: number | string | null;
        agentId: string | null;
        agentName: string | null;
      }>();

    return rows.map(
      (row): MarketOrderSummary => ({
        id: row.orderId,
        taskId: row.taskId,
        status: row.orderStatus,
        amountCny: Number(row.amountCny),
        bidPriceCny: row.bidPriceCny === null ? null : Number(row.bidPriceCny),
        agentId: row.agentId,
        agentName: row.agentName,
      }),
    );
  }

  private async enrichMarketTasks(tasks: Task[]) {
    if (tasks.length === 0) return [];
    const taskIds = tasks.map((t) => t.id);

    const [bidStats, orders, totalAgents] = await Promise.all([
      this.bidsRepository
        .createQueryBuilder('bid')
        .select('bid.task_id', 'taskId')
        .addSelect('COUNT(bid.id)', 'totalCount')
        .addSelect(
          'COUNT(CASE WHEN bid.status = :submittedStatus THEN 1 END)',
          'activeCount',
        )
        .addSelect(
          'MIN(CASE WHEN bid.status = :submittedStatus THEN bid.priceCny ELSE NULL END)',
          'minPrice',
        )
        .where('bid.task_id IN (:...taskIds)', {
          taskIds,
          submittedStatus: BidStatus.SUBMITTED,
        })
        .groupBy('bid.task_id')
        .getRawMany<{
          taskId: string;
          totalCount: string;
          activeCount: string;
          minPrice: string | null;
        }>(),
      this.findMarketOrderSummaries(taskIds),
      this.getAvailableAgentCount(),
    ]);

    const bidStatsMap = new Map<
      string,
      { activeCount: number; totalCount: number; minPrice: number | null }
    >();
    for (const row of bidStats) {
      bidStatsMap.set(row.taskId, {
        activeCount: Number.parseInt(row.activeCount, 10),
        totalCount: Number.parseInt(row.totalCount, 10),
        minPrice: row.minPrice ? Number(row.minPrice) : null,
      });
    }

    const orderMap = new Map<string, MarketOrderSummary>();
    for (const order of orders) {
      if (!orderMap.has(order.taskId)) {
        orderMap.set(order.taskId, order);
      }
    }

    return tasks.map((task): TaskWithMarketMeta => {
      const stats = bidStatsMap.get(task.id);
      const order = orderMap.get(task.id) || null;
      const marketStatus = this.marketStatusFor(task, order);
      const selectedAgent = order?.agentId
        ? {
            id: order.agentId,
            name: order.agentName,
          }
        : null;

      return {
        ...task,
        bidsCount: stats?.activeCount ?? 0,
        totalBidsCount: stats?.totalCount ?? 0,
        latestBid: stats?.minPrice ?? null,
        matchedAgents: totalAgents,
        marketStatus,
        marketStatusLabel: this.marketStatusLabel(marketStatus),
        isAcceptingBids: task.status === TaskStatus.OPEN && !order,
        orderId: order?.id || null,
        orderStatus: order?.status || null,
        selectedAgent,
        dealPriceCny: order?.amountCny ?? order?.bidPriceCny ?? null,
      };
    });
  }

  async findOpenMarketTasks(filters?: TaskSearchFilters) {
    const qb = this.tasksRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.client', 'client')
      .where('task.status = :status', { status: TaskStatus.OPEN });

    this.applyMarketFilters(qb, filters);
    this.applyMarketSort(qb, filters);

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    qb.skip((page - 1) * limit).take(limit);

    const [tasks, total] = await qb.getManyAndCount();
    if (tasks.length === 0) {
      return { data: [], pagination: { page, limit, total, totalPages: 0 } };
    }

    const tasksWithMeta = await this.enrichMarketTasks(tasks);

    return {
      data: tasksWithMeta,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findMarketTasks(filters?: TaskSearchFilters): Promise<MarketTaskPage> {
    const cacheKey = this.marketCacheKey(filters);
    const cached = this.marketResultCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    if (cached && cached.staleUntil > now) {
      void this.loadMarketResult(cacheKey, filters).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Task market background refresh failed: ${message}`);
      });
      return cached.value;
    }

    return this.loadMarketResult(cacheKey, filters);
  }

  private loadMarketResult(
    cacheKey: string,
    filters?: TaskSearchFilters,
  ): Promise<MarketTaskPage> {
    const pending = this.marketResultRequests.get(cacheKey);
    if (pending) return pending;

    const request = this.findMarketTasksUncached(filters)
      .then((value) => {
        this.marketResultCache.set(cacheKey, {
          value,
          expiresAt: Date.now() + this.marketCacheTtlMs,
          staleUntil:
            Date.now() + this.marketCacheTtlMs + this.marketCacheStaleMs,
        });
        return value;
      })
      .finally(() => {
        this.marketResultRequests.delete(cacheKey);
      });
    this.marketResultRequests.set(cacheKey, request);
    return request;
  }

  private async findMarketTasksUncached(
    filters?: TaskSearchFilters,
  ): Promise<MarketTaskPage> {
    const statusGroup = filters?.statusGroup || 'all';
    const qb = this.tasksRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.client', 'client')
      .where('task.status != :draft', { draft: TaskStatus.DRAFT });

    const requiresOrderJoin = ['executing', 'completed', 'abnormal'].includes(
      statusGroup,
    );
    if (requiresOrderJoin) {
      qb.leftJoin('task.orders', 'marketOrder').distinct(true);
    }

    this.applyMarketFilters(qb, filters);

    switch (statusGroup) {
      case 'bidding':
        qb.andWhere('task.status = :openStatus', {
          openStatus: TaskStatus.OPEN,
        });
        break;
      case 'executing':
        qb.andWhere('marketOrder.status IN (:...executingStatuses)', {
          executingStatuses: [
            OrderStatus.PENDING_PAYMENT,
            OrderStatus.IN_PROGRESS,
            OrderStatus.DELIVERED,
            OrderStatus.ACCEPTED,
            OrderStatus.PENDING_RELEASE,
          ],
        });
        break;
      case 'completed':
        qb.andWhere('marketOrder.status = :completedStatus', {
          completedStatus: OrderStatus.COMPLETED,
        });
        break;
      case 'abnormal':
        qb.andWhere(
          '(marketOrder.status IN (:...abnormalStatuses) OR (task.status = :closedStatus AND marketOrder.id IS NULL))',
          {
            abnormalStatuses: [
              OrderStatus.REJECTED,
              OrderStatus.ARBITRATING,
              OrderStatus.REFUNDED,
              OrderStatus.CANCELED,
            ],
            closedStatus: TaskStatus.CLOSED,
          },
        );
        break;
      default:
        break;
    }

    this.applyMarketSort(qb, filters);

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    qb.skip((page - 1) * limit).take(limit);

    const [tasks, total] = await qb.getManyAndCount();
    if (tasks.length === 0) {
      return { data: [], pagination: { page, limit, total, totalPages: 0 } };
    }

    const tasksWithMeta = await this.enrichMarketTasks(tasks);

    return {
      data: tasksWithMeta,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    return this.tasksRepository.findOne({
      where: { id },
      relations: ['client'],
    });
  }

  async findByClient(clientId: string) {
    return this.tasksRepository.find({
      where: { clientUserId: clientId },
      relations: ['client'],
      order: { createdAt: 'DESC' },
    });
  }

  private getTaskClientId(task: Task) {
    return task.client?.id || task.clientUserId;
  }

  private assertTaskOwner(task: Task, userId: string) {
    const taskClientId = this.getTaskClientId(task);
    if (!taskClientId) {
      throw new BadRequestException('Task has no publisher');
    }
    if (userId !== taskClientId) {
      throw new BadRequestException(
        'Only the task publisher can update this task',
      );
    }
  }

  async updateTask(id: string, data: UpdateTaskDto) {
    if (!data.userId) throw new BadRequestException('userId is required');
    const task = await this.tasksRepository.findOne({
      where: { id },
      relations: ['client'],
    });
    if (!task) throw new NotFoundException('Task not found');
    this.assertTaskOwner(task, data.userId);
    if (task.status !== TaskStatus.OPEN) {
      throw new BadRequestException('Only open tasks can be updated');
    }

    if (data.title !== undefined) task.title = data.title;
    if (data.description !== undefined) task.description = data.description;
    if (data.acceptanceCriteria !== undefined) {
      task.acceptanceCriteria = data.acceptanceCriteria;
    }
    if (data.budgetCny !== undefined) task.budgetCny = data.budgetCny;
    if (data.expectedDeliveryAt !== undefined) {
      task.expectedDeliveryAt = data.expectedDeliveryAt
        ? new Date(data.expectedDeliveryAt)
        : null;
    }
    if (data.tags !== undefined) task.tags = this.normalizeList(data.tags);
    if (data.skillsRequired !== undefined) {
      task.skillsRequired = this.normalizeList(data.skillsRequired);
    }
    if (data.attachmentUrls !== undefined) {
      task.attachmentUrls = this.normalizeList(data.attachmentUrls);
    }

    const saved = await this.tasksRepository.save(task);
    this.invalidateMarketCache();
    return this.findOne(saved.id);
  }

  async closeTask(id: string, userId: string) {
    if (!userId) throw new BadRequestException('userId is required');
    const task = await this.tasksRepository.findOne({
      where: { id },
      relations: ['client'],
    });
    if (!task) throw new NotFoundException('Task not found');
    this.assertTaskOwner(task, userId);
    if (task.status !== TaskStatus.OPEN) return task;

    task.status = TaskStatus.CLOSED;
    const saved = await this.tasksRepository.save(task);
    await this.bidsRepository
      .createQueryBuilder()
      .update(Bid)
      .set({ status: BidStatus.REJECTED })
      .where('task_id = :taskId', { taskId: task.id })
      .andWhere('status = :status', { status: BidStatus.SUBMITTED })
      .execute();

    this.invalidateMarketCache();
    return saved;
  }

  async selectBid(id: string, data: SelectBidDto) {
    // 1. 楠岃瘉 Task
    const task = await this.tasksRepository.findOne({
      where: { id },
      relations: ['client'],
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.status !== TaskStatus.OPEN) {
      throw new BadRequestException('Task is not open for bidding');
    }

    // 2. 楠岃瘉 Bid
    const bid = await this.bidsRepository.findOne({
      where: { id: data.bidId },
      relations: ['task', 'agent', 'agent.owner'],
    });
    if (!bid) throw new NotFoundException('Bid not found');
    if (bid.task?.id && bid.task.id !== task.id) {
      throw new BadRequestException('Bid does not belong to this task');
    }
    if (bid.status !== BidStatus.SUBMITTED) {
      throw new BadRequestException('Bid is not selectable');
    }

    // 3. 楠岃瘉 Client (Employer)
    // 鏀寔 client 鍏宠仈鎴?clientUserId 瀛楁
    const taskClientId = task.client?.id || task.clientUserId;
    if (!taskClientId) {
      throw new BadRequestException('Task has no publisher');
    }
    if (data.userId !== taskClientId) {
      throw new BadRequestException('Only the task publisher can select a bid');
    }
    const client = await this.usersRepository.findOne({
      where: { id: taskClientId },
    });

    // 4. 鐢熸垚璁㈠崟 (Order)
    const order = this.ordersRepository.create({
      task: task,
      bid: bid,
      clientUserId: taskClientId,
      client: client || undefined,
      ownerUserId: bid.agent?.owner?.id,
      owner: bid.agent?.owner || undefined,
      amountCny: bid.priceCny,
      platformFeeRate: 0,
      platformFeeCny: 0,
      payoutCny: bid.priceCny,
      status: OrderStatus.PENDING_PAYMENT,
    });
    const savedOrder = await this.ordersRepository.save(order);

    // [杩借釜鐐筣 璁㈠崟鍒涘缓
    console.log(
      `[ORDER-FLOW] 璁㈠崟鍒涘缓 | orderId=${savedOrder.id} | taskId=${task.id} | bidId=${bid.id} | amount=${savedOrder.amountCny}`,
    );

    // 5. 鏇存柊浠诲姟鐘舵€?
    task.status = TaskStatus.CLOSED; // 鎴栨祦杞埌涓嬩竴涓姸鎬?
    await this.tasksRepository.save(task);

    bid.status = BidStatus.ACCEPTED;
    await this.bidsRepository.save(bid);
    await this.bidsRepository
      .createQueryBuilder()
      .update(Bid)
      .set({ status: BidStatus.REJECTED })
      .where('task_id = :taskId', { taskId: task.id })
      .andWhere('id != :bidId', { bidId: bid.id })
      .andWhere('status = :status', { status: BidStatus.SUBMITTED })
      .execute();

    this.invalidateMarketCache();
    return savedOrder;
  }

  async findBids(id: string) {
    const task = await this.findOne(id);
    if (!task) throw new NotFoundException('Task not found');
    const bids = await this.bidsRepository.find({
      where: { task: { id } },
      relations: ['agent', 'agent.owner', 'task'],
    });
    return this.bidsRankingService.rank(bids);
  }
}
