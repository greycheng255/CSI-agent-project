import {
  Injectable,
  NotFoundException,
  BadRequestException,
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
  page?: number;
  limit?: number;
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
export class TasksService {
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
    void this.notifyAgents(saved);
    return saved;
  }

  async findMarketTasks(filters?: TaskSearchFilters) {
    const qb = this.tasksRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.client', 'client')
      .where('task.status = :status', { status: TaskStatus.OPEN });

    if (filters?.keyword) {
      qb.andWhere(
        '(task.title LIKE :keyword OR task.description LIKE :keyword)',
        { keyword: `%${filters.keyword}%` },
      );
    }

    if (filters?.minBudget !== undefined) {
      qb.andWhere('task.budgetCny >= :minBudget', { minBudget: filters.minBudget });
    }
    if (filters?.maxBudget !== undefined) {
      qb.andWhere('task.budgetCny <= :maxBudget', { maxBudget: filters.maxBudget });
    }

    // 标签过滤走 SQL（PostgreSQL array overlap）
    if (filters?.tags && filters.tags.length > 0) {
      qb.andWhere('task.tags && :tags', { tags: filters.tags });
    }

    switch (filters?.sortBy) {
      case 'budget_desc': qb.orderBy('task.budgetCny', 'DESC'); break;
      case 'budget_asc': qb.orderBy('task.budgetCny', 'ASC'); break;
      default: qb.orderBy('task.createdAt', 'DESC'); break;
    }

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    qb.skip((page - 1) * limit).take(limit);

    const [tasks, total] = await qb.getManyAndCount();
    if (tasks.length === 0) {
      return { data: [], pagination: { page, limit, total, totalPages: 0 } };
    }

    const taskIds = tasks.map((t) => t.id);

    // 批量查询：一次拿所有 task 的报价数和最低报价
    const bidStats = await this.bidsRepository
      .createQueryBuilder('bid')
      .select('bid.task_id', 'taskId')
      .addSelect('COUNT(bid.id)', 'count')
      .addSelect('MIN(bid.priceCny)', 'minPrice')
      .where('bid.task_id IN (:...taskIds)', { taskIds })
      .andWhere('bid.status = :status', { status: BidStatus.SUBMITTED })
      .groupBy('bid.task_id')
      .getRawMany<{ taskId: string; count: string; minPrice: string | null }>();

    const bidMap = new Map<string, { count: number; minPrice: number | null }>();
    for (const row of bidStats) {
      bidMap.set(row.taskId, { count: parseInt(row.count, 10), minPrice: row.minPrice ? Number(row.minPrice) : null });
    }

    // 批量查询：一次拿所有 task 的匹配 Agent 数
    const agentCount = await this.agentsRepository
      .createQueryBuilder('agent')
      .select('COUNT(agent.id)', 'cnt')
      .where('agent.approvalStatus = :approved', { approved: 'approved' })
      .andWhere('agent.isActive = :active', { active: true })
      .andWhere('agent.runtimeStatus IN (:...statuses)', { statuses: ['online', 'degraded'] })
      .getRawOne<{ cnt: string }>();
    const totalAgents = parseInt(agentCount?.cnt || '0', 10);

    const tasksWithMeta = tasks.map((task) => {
      const stats = bidMap.get(task.id);
      return {
        ...task,
        bidsCount: stats?.count ?? 0,
        latestBid: stats?.minPrice ?? null,
        matchedAgents: totalAgents,
      };
    });

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
      throw new BadRequestException('Only the task publisher can update this task');
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
      platformFeeRate: 0.05, // 5% 鏈嶅姟璐?
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
