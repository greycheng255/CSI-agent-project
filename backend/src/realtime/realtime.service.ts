import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RealtimeGateway } from './realtime.gateway';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { Task, TaskStatus } from '../tasks/entities/task.entity';
import { Bid } from '../bids/entities/bid.entity';

export interface TradeEvent {
  id: string;
  type:
    | 'ORDER_CREATED'
    | 'ORDER_PAID'
    | 'ORDER_DELIVERED'
    | 'ORDER_COMPLETED'
    | 'TASK_CREATED'
    | 'BID_PLACED';
  title: string;
  amount?: number;
  agentName?: string;
  timestamp: Date;
}

export interface PlatformStats {
  totalOrders: number;
  completedOrders: number;
  totalAmount: number;
  todayAmount: number;
  onlineAgents: number;
  activeTasks: number;
}

@Injectable()
export class RealtimeService implements OnModuleInit {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(
    private readonly realtimeGateway: RealtimeGateway,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(Bid)
    private readonly bidRepo: Repository<Bid>,
  ) {}

  onModuleInit() {
    // 启动定时广播统计数据
    setInterval(() => {
      this.broadcastStats().catch((err) => {
        this.logger.error('Failed to broadcast stats:', err);
      });
    }, 30000); // 每 30 秒广播一次
  }

  /**
   * 广播交易事件
   */
  broadcastTradeEvent(event: TradeEvent): void {
    this.realtimeGateway.broadcastTradeEvent(event.type, {
      id: event.id,
      title: event.title,
      amount: event.amount,
      agentName: event.agentName,
      timestamp: event.timestamp,
    });
    this.logger.debug(
      `Broadcasted trade event: ${event.type} - ${event.title}`,
    );
  }

  /**
   * 广播订单更新
   */
  broadcastOrderUpdate(
    orderId: string,
    status: OrderStatus,
    data?: unknown,
  ): void {
    this.realtimeGateway.broadcastOrderUpdate(orderId, status, data);
  }

  /**
   * 广播新任务
   */
  broadcastNewTask(task: Task): void {
    this.realtimeGateway.broadcastNewTask({
      id: task.id,
      title: task.title,
      budgetCny: task.budgetCny,
      status: task.status,
      createdAt: task.createdAt,
    });
  }

  /**
   * 广播新竞价
   */
  broadcastNewBid(taskId: string, bid: Bid, agentName: string): void {
    this.realtimeGateway.broadcastNewBid(taskId, {
      id: bid.id,
      priceCny: bid.priceCny,
      planSummary: bid.planSummary,
      agentName,
      createdAt: bid.createdAt,
    });
  }

  /**
   * 获取并广播平台统计数据
   */
  async broadcastStats(): Promise<void> {
    const stats = await this.getPlatformStats();
    this.realtimeGateway.broadcastStats({ ...stats } as Record<
      string,
      unknown
    >);
  }

  /**
   * 获取平台统计数据
   */
  async getPlatformStats(): Promise<PlatformStats> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalOrders,
      completedOrders,
      totalAmount,
      todayAmount,
      activeTasks,
    ] = await Promise.all([
      this.orderRepo.count(),
      this.orderRepo.count({ where: { status: OrderStatus.COMPLETED } }),
      this.orderRepo
        .createQueryBuilder('order')
        .where('order.status IN (:...statuses)', {
          statuses: [OrderStatus.COMPLETED, OrderStatus.ACCEPTED],
        })
        .select('SUM(order.amountCny)', 'total')

        .getRawOne()
        .then((r) => parseInt((r as { total?: string })?.total || '0')),
      this.orderRepo
        .createQueryBuilder('order')
        .where('order.status IN (:...statuses)', {
          statuses: [OrderStatus.COMPLETED, OrderStatus.ACCEPTED],
        })
        .andWhere('order.createdAt >= :today', { today })
        .select('SUM(order.amountCny)', 'total')

        .getRawOne()
        .then((r) => parseInt((r as { total?: string })?.total || '0')),
      this.taskRepo.count({ where: { status: TaskStatus.OPEN } }),
    ]);

    return {
      totalOrders,
      completedOrders,
      totalAmount,
      todayAmount,
      onlineAgents: 0, // TODO: 从 Agent 服务获取在线数
      activeTasks,
    };
  }

  /**
   * 获取最近的交易流
   */
  async getRecentTradeEvents(limit: number = 20): Promise<TradeEvent[]> {
    const events: TradeEvent[] = [];

    // 获取最近的订单
    const recentOrders = await this.orderRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
      relations: ['task', 'bid', 'bid.agent'],
    });

    for (const order of recentOrders) {
      let type: TradeEvent['type'] = 'ORDER_CREATED';
      if (order.status === OrderStatus.COMPLETED) type = 'ORDER_COMPLETED';
      else if (order.status === OrderStatus.IN_PROGRESS) type = 'ORDER_PAID';
      else if (order.status === OrderStatus.DELIVERED) type = 'ORDER_DELIVERED';

      events.push({
        id: order.id,
        type,
        title: order.task?.title || 'Unknown Task',
        amount: order.amountCny,
        agentName: order.bid?.agent?.name,
        timestamp: order.createdAt,
      });
    }

    // 按时间排序
    return events
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }
}
