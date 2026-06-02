import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task, TaskStatus } from './entities/task.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { Bid } from '../bids/entities/bid.entity';
import { Agent, AgentStatus } from '../agents/entities/agent.entity';
import { User } from '../users/entities/user.entity';
import {
  WebhookDelivery,
  WebhookDeliveryStatus,
} from '../webhooks/entities/webhook-delivery.entity';

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
};

type SelectBidDto = {
  bidId: string;
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
  ) {}

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
    const agents = await this.agentsRepository.find({
      where: { status: AgentStatus.ONLINE },
    });

    const targetAgents = agents.filter(
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

    // 关键词搜索
    if (filters?.keyword) {
      qb.andWhere(
        '(task.title LIKE :keyword OR task.description LIKE :keyword)',
        { keyword: `%${filters.keyword}%` },
      );
    }

    // 预算范围筛选
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

    // 排序
    switch (filters?.sortBy) {
      case 'budget_desc':
        qb.orderBy('task.budgetCny', 'DESC');
        break;
      case 'budget_asc':
        qb.orderBy('task.budgetCny', 'ASC');
        break;
      case 'newest':
      default:
        qb.orderBy('task.createdAt', 'DESC');
        break;
    }

    // 分页
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    qb.skip((page - 1) * limit).take(limit);

    const [tasks, total] = await qb.getManyAndCount();

    // 为了前端展示，补充一些 Mock 数据
    const tasksWithMeta = tasks.map((task) => ({
      ...task,
      bidsCount: Math.floor(Math.random() * 10),
      latestBid: Math.floor(task.budgetCny * 0.8),
      tags: ['AI', '开发'], // TODO: 实体增加 tags 字段
    }));

    return {
      data: tasksWithMeta,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
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

  async selectBid(id: string, data: SelectBidDto) {
    // 1. 验证 Task
    const task = await this.tasksRepository.findOne({
      where: { id },
      relations: ['client'],
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.status !== TaskStatus.OPEN) {
      throw new BadRequestException('Task is not open for bidding');
    }

    // 2. 验证 Bid
    const bid = await this.bidsRepository.findOne({
      where: { id: data.bidId },
      relations: ['agent', 'agent.owner'],
    });
    if (!bid) throw new NotFoundException('Bid not found');

    // 3. 验证 Client (Employer)
    // 支持 client 关联或 clientUserId 字段
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

    // 4. 生成订单 (Order)
    const order = this.ordersRepository.create({
      task: task,
      bid: bid,
      clientUserId: taskClientId,
      client: client || undefined,
      ownerUserId: bid.agent?.owner?.id,
      owner: bid.agent?.owner || undefined,
      amountCny: bid.priceCny,
      platformFeeRate: 0.05, // 5% 服务费
      status: OrderStatus.PENDING_PAYMENT,
    });
    const savedOrder = await this.ordersRepository.save(order);

    // [追踪点] 订单创建
    console.log(
      `[ORDER-FLOW] 订单创建 | orderId=${savedOrder.id} | taskId=${task.id} | bidId=${bid.id} | amount=${savedOrder.amountCny}`,
    );

    // 5. 更新任务状态
    task.status = TaskStatus.CLOSED; // 或流转到下一个状态
    await this.tasksRepository.save(task);

    return savedOrder;
  }
}
