/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Task } from '../tasks/entities/task.entity';
import { Bid } from '../bids/entities/bid.entity';
import { Order } from '../orders/entities/order.entity';
import { Agent, AgentStatus } from '../agents/entities/agent.entity';
import { User } from '../users/entities/user.entity';

interface DateRange {
  days?: number;
  startDate?: Date;
  endDate?: Date;
}

// 数据库原始查询结果类型
interface StatusCountResult {
  status: string;
  count: string;
}

interface DateCountResult {
  date: string;
  count: string;
}

interface AvgPriceResult {
  avg: string;
}

interface DatePriceResult {
  date: string;
  count: string;
  avgPrice: string;
}

interface AgentBidResult {
  id: string;
  name: string;
  bidCount: string;
  avgPrice: string;
}

interface UserAgentResult {
  id: string;
  name: string;
  agentCount: string;
}

@Injectable()
export class MetricsService {
  constructor(
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
    @InjectRepository(Bid)
    private bidsRepository: Repository<Bid>,
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    @InjectRepository(Agent)
    private agentsRepository: Repository<Agent>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  private getDateRange(range?: DateRange): { start: Date; end: Date } {
    const end = new Date();
    let start: Date;

    if (range?.startDate && range?.endDate) {
      start = range.startDate;
    } else if (range?.days) {
      start = new Date(end.getTime() - range.days * 24 * 60 * 60 * 1000);
    } else {
      start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000); // 默认 7 天
    }

    return { start, end };
  }

  /**
   * 获取整体概览指标
   */
  async getOverview() {
    const [
      totalUsers,
      totalAgents,
      onlineAgents,
      totalTasks,
      openTasks,
      totalBids,
      totalOrders,
      completedOrders,
    ] = await Promise.all([
      this.usersRepository.count(),
      this.agentsRepository.count(),
      this.agentsRepository.count({ where: { status: AgentStatus.ONLINE } }),
      this.tasksRepository.count(),
      this.tasksRepository.count({ where: { status: 'OPEN' as any } }),
      this.bidsRepository.count(),
      this.ordersRepository.count(),
      this.ordersRepository.count({ where: { status: 'COMPLETED' as any } }),
    ]);

    return {
      users: { total: totalUsers },
      agents: {
        total: totalAgents,
        online: onlineAgents,
        offline: totalAgents - onlineAgents,
      },
      tasks: {
        total: totalTasks,
        open: openTasks,
        closed: totalTasks - openTasks,
      },
      bids: { total: totalBids },
      orders: {
        total: totalOrders,
        completed: completedOrders,
        pending: totalOrders - completedOrders,
      },
    };
  }

  /**
   * 获取任务指标
   */
  async getTaskMetrics(range?: DateRange) {
    const { start, end } = this.getDateRange(range);

    const [tasksInRange, tasksByStatus, tasksByDay] = await Promise.all([
      this.tasksRepository.count({
        where: { createdAt: Between(start, end) as any },
      }),
      this.tasksRepository
        .createQueryBuilder('task')
        .select('task.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('task.status')
        .getRawMany(),
      this.tasksRepository
        .createQueryBuilder('task')
        .select("DATE_TRUNC('day', task.createdAt)", 'date')
        .addSelect('COUNT(*)', 'count')
        .where('task.createdAt BETWEEN :start AND :end', { start, end })
        .groupBy("DATE_TRUNC('day', task.createdAt)")
        .orderBy("DATE_TRUNC('day', task.createdAt)", 'ASC')
        .getRawMany(),
    ]);

    return {
      period: { start: start.toISOString(), end: end.toISOString() },
      totalInPeriod: tasksInRange,
      byStatus: tasksByStatus.map((t) => ({
        status: t.status,
        count: parseInt(t.count, 10),
      })),
      dailyTrend: tasksByDay.map((t) => ({
        date: t.date,
        count: parseInt(t.count, 10),
      })),
    };
  }

  /**
   * 获取报价指标
   */
  async getBidMetrics(range?: DateRange & { agentId?: string }) {
    const { start, end } = this.getDateRange(range);

    const where: any = { createdAt: Between(start, end) };
    if (range?.agentId) {
      where.agent = { id: range.agentId };
    }

    const [bidsInRange, avgPrice, bidSuccessRate, bidsByDay] =
      await Promise.all([
        this.bidsRepository.count({ where }),
        this.bidsRepository
          .createQueryBuilder('bid')
          .select('AVG(bid.priceCny)', 'avg')
          .where('bid.createdAt BETWEEN :start AND :end', { start, end })
          .getRawOne(),
        this.calculateBidSuccessRate(start, end, range?.agentId),
        this.bidsRepository
          .createQueryBuilder('bid')
          .select("DATE_TRUNC('day', bid.createdAt)", 'date')
          .addSelect('COUNT(*)', 'count')
          .addSelect('AVG(bid.priceCny)', 'avgPrice')
          .where('bid.createdAt BETWEEN :start AND :end', { start, end })
          .groupBy("DATE_TRUNC('day', bid.createdAt)")
          .orderBy("DATE_TRUNC('day', bid.createdAt)", 'ASC')
          .getRawMany(),
      ]);

    return {
      period: { start: start.toISOString(), end: end.toISOString() },
      totalInPeriod: bidsInRange,
      averagePrice: avgPrice?.avg ? parseFloat(avgPrice.avg) : 0,
      successRate: bidSuccessRate,
      dailyTrend: bidsByDay.map((b) => ({
        date: b.date,
        count: parseInt(b.count, 10),
        avgPrice: parseFloat(b.avgPrice || '0'),
      })),
    };
  }

  /**
   * 计算报价成功率
   */
  private async calculateBidSuccessRate(
    start: Date,
    end: Date,
    agentId?: string,
  ): Promise<number> {
    const query = this.bidsRepository
      .createQueryBuilder('bid')
      .leftJoin('bid.orders', 'order')
      .select('COUNT(*)', 'total')
      .addSelect('COUNT(CASE WHEN order.id IS NOT NULL THEN 1 END)', 'success')
      .where('bid.createdAt BETWEEN :start AND :end', { start, end });

    if (agentId) {
      query.andWhere('bid.agent.id = :agentId', { agentId });
    }

    const result = await query.getRawOne();
    const total = parseInt(result?.total || '0', 10);
    const success = parseInt(result?.success || '0', 10);

    return total > 0 ? Math.round((success / total) * 100) : 0;
  }

  /**
   * 获取订单指标
   */
  async getOrderMetrics(range?: DateRange) {
    const { start, end } = this.getDateRange(range);

    const [ordersInRange, ordersByStatus, revenue, ordersByDay] =
      await Promise.all([
        this.ordersRepository.count({
          where: { createdAt: Between(start, end) as any },
        }),
        this.ordersRepository
          .createQueryBuilder('o')
          .select('o.status', 'status')
          .addSelect('COUNT(*)', 'count')
          .groupBy('o.status')
          .getRawMany(),
        this.ordersRepository
          .createQueryBuilder('o')
          .select('SUM(o.amountCny)', 'total')
          .where('o.status = :status', { status: 'COMPLETED' })
          .andWhere('o.createdAt BETWEEN :start AND :end', { start, end })
          .getRawOne(),
        this.ordersRepository
          .createQueryBuilder('o')
          .select("DATE_TRUNC('day', o.createdAt)", 'date')
          .addSelect('COUNT(*)', 'count')
          .addSelect('SUM(o.amountCny)', 'revenue')
          .where('o.createdAt BETWEEN :start AND :end', { start, end })
          .groupBy("DATE_TRUNC('day', o.createdAt)")
          .orderBy("DATE_TRUNC('day', o.createdAt)", 'ASC')
          .getRawMany(),
      ]);

    return {
      period: { start: start.toISOString(), end: end.toISOString() },
      totalInPeriod: ordersInRange,
      byStatus: ordersByStatus.map((o) => ({
        status: o.status,
        count: parseInt(o.count, 10),
      })),
      totalRevenue: revenue?.total ? parseFloat(revenue.total) : 0,
      dailyTrend: ordersByDay.map((o) => ({
        date: o.date,
        count: parseInt(o.count, 10),
        revenue: parseFloat(o.revenue || '0'),
      })),
    };
  }

  /**
   * 获取 Agent 指标
   */
  async getAgentMetrics() {
    const [agents, onlineAgents, agentsWithBids] = await Promise.all([
      this.agentsRepository.find({
        relations: ['bids'],
        order: { createdAt: 'DESC' },
      }),
      this.agentsRepository.count({ where: { status: AgentStatus.ONLINE } }),
      this.agentsRepository
        .createQueryBuilder('agent')
        .leftJoinAndSelect('agent.bids', 'bid')
        .select('agent.id', 'id')
        .addSelect('agent.name', 'name')
        .addSelect('COUNT(bid.id)', 'bidCount')
        .addSelect('AVG(bid.priceCny)', 'avgPrice')
        .groupBy('agent.id')
        .addGroupBy('agent.name')
        .getRawMany(),
    ]);

    return {
      total: agents.length,
      online: onlineAgents,
      offline: agents.length - onlineAgents,
      agents: agentsWithBids.map((a) => ({
        id: a.id,
        name: a.name,
        bidCount: parseInt(a.bidCount, 10),
        avgPrice: a.avgPrice ? parseFloat(a.avgPrice) : 0,
      })),
    };
  }

  /**
   * 获取用户指标
   */
  async getUserMetrics() {
    const [totalUsers, recentUsers, usersWithAgents] = await Promise.all([
      this.usersRepository.count(),
      this.usersRepository.count({
        where: {
          createdAt: Between(
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            new Date(),
          ) as any,
        },
      }),
      this.usersRepository
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.agents', 'agent')
        .select('user.id', 'id')
        .addSelect('user.name', 'name')
        .addSelect('COUNT(agent.id)', 'agentCount')
        .groupBy('user.id')
        .addGroupBy('user.name')
        .getRawMany(),
    ]);

    return {
      total: totalUsers,
      newThisWeek: recentUsers,
      users: usersWithAgents.map((u) => ({
        id: u.id,
        name: u.name,
        agentCount: parseInt(u.agentCount, 10),
      })),
    };
  }

  /**
   * 获取仪表盘数据（聚合所有关键指标）
   */
  async getDashboardData() {
    const { start, end } = this.getDateRange({ days: 7 });

    const [overview, taskMetrics, bidMetrics, orderMetrics, agentMetrics] =
      await Promise.all([
        this.getOverview(),
        this.getTaskMetrics({ days: 7 }),
        this.getBidMetrics({ days: 7 }),
        this.getOrderMetrics({ days: 7 }),
        this.getAgentMetrics(),
      ]);

    return {
      summary: {
        totalRevenue: orderMetrics.totalRevenue,
        totalTasks: overview.tasks.total,
        totalBids: overview.bids.total,
        totalOrders: overview.orders.total,
        onlineAgents: overview.agents.online,
        completionRate:
          overview.orders.total > 0
            ? Math.round(
                (overview.orders.completed / overview.orders.total) * 100,
              )
            : 0,
      },
      trends: {
        tasks: taskMetrics.dailyTrend,
        bids: bidMetrics.dailyTrend,
        orders: orderMetrics.dailyTrend,
      },
      agents: agentMetrics,
      period: { start: start.toISOString(), end: end.toISOString() },
    };
  }
}
