import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Workspace } from './workspace.entity';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { MarketplaceDelivery } from '../marketplace-orders/delivery.entity';
import { MarketplaceDispute } from '../disputes/dispute.entity';
import { MarketplaceTask } from '../marketplace-tasks/marketplace-task.entity';
import {
  CreditOrderFact,
  WorkspaceCreditSummary,
  computeWorkspaceCredit,
} from './credit-scoring';

/**
 * 信用数据自动计算服务（PRD §5.6.7）：
 * 从 M 侧真实的订单 / 交付 / 纠纷数据聚合出 workspace 四项信用指标并写回投影表。
 * 只有本服务写这四列——`WorkspacesService.updateShowcase` 刻意不接收，保证「平台自动计算、不可修改」。
 */
@Injectable()
export class WorkspaceCreditService {
  private readonly logger = new Logger(WorkspaceCreditService.name);

  constructor(
    @InjectRepository(Workspace)
    private readonly workspacesRepo: Repository<Workspace>,
    @InjectRepository(MarketplaceOrder)
    private readonly ordersRepo: Repository<MarketplaceOrder>,
    @InjectRepository(MarketplaceDelivery)
    private readonly deliveriesRepo: Repository<MarketplaceDelivery>,
    @InjectRepository(MarketplaceDispute)
    private readonly disputesRepo: Repository<MarketplaceDispute>,
    @InjectRepository(MarketplaceTask)
    private readonly tasksRepo: Repository<MarketplaceTask>,
  ) {}

  /**
   * 重算单个 workspace 信用数据；返回是否发生变更与其信用摘要。
   * workspace 不存在返回 null（调用方自行决定语义）。
   */
  async recompute(
    workspaceId: string,
  ): Promise<{ changed: boolean; credit: WorkspaceCreditSummary } | null> {
    const ws = await this.workspacesRepo.findOne({ where: { id: workspaceId } });
    if (!ws) return null;

    const orders = await this.ordersRepo.find({
      where: { workspaceId },
    });
    const facts = await this.buildFacts(orders);
    const credit = computeWorkspaceCredit(facts);

    const changed =
      ws.completedTasksCount !== credit.completedTasksCount ||
      Number(ws.avgRating) !== credit.avgRating ||
      Number(ws.onTimeRate) !== credit.onTimeRate ||
      Number(ws.disputeRate) !== credit.disputeRate;

    if (changed) {
      ws.completedTasksCount = credit.completedTasksCount;
      ws.avgRating = credit.avgRating;
      ws.onTimeRate = credit.onTimeRate;
      ws.disputeRate = credit.disputeRate;
      await this.workspacesRepo.save(ws);
    }
    return { changed, credit };
  }

  /**
   * 重算全部 workspace（定时任务入口）；返回发生变更的 workspace 数量。
   * 无任何订单的 workspace 直接归零（含历史手工播种数据的清理）。
   */
  async recomputeAll(): Promise<number> {
    const workspaces = await this.workspacesRepo.find();
    let changedCount = 0;
    for (const ws of workspaces) {
      const result = await this.recompute(ws.id);
      if (result?.changed) changedCount += 1;
    }
    return changedCount;
  }

  /** 把订单集合拼装为信用事件事实（批量查询交付/纠纷/任务，避免 N+1） */
  private async buildFacts(
    orders: MarketplaceOrder[],
  ): Promise<CreditOrderFact[]> {
    if (orders.length === 0) return [];
    const orderIds = orders.map((o) => o.id);
    const taskIds = [...new Set(orders.map((o) => o.marketplaceTaskId))];

    const [deliveries, disputes, tasks] = await Promise.all([
      this.deliveriesRepo.find({ where: { orderId: In(orderIds) } }),
      this.disputesRepo.find({ where: { orderId: In(orderIds) } }),
      taskIds.length
        ? this.tasksRepo.find({ where: { id: In(taskIds) } })
        : Promise.resolve([] as MarketplaceTask[]),
    ]);

    const deliveriesByOrder = new Map<string, MarketplaceDelivery[]>();
    for (const d of deliveries) {
      const list = deliveriesByOrder.get(d.orderId) ?? [];
      list.push(d);
      deliveriesByOrder.set(d.orderId, list);
    }
    const disputedOrders = new Set(disputes.map((d) => d.orderId));
    const expectedByTask = new Map(
      tasks.map((t) => [t.id, t.expectedDeliveryAt ?? null]),
    );

    return orders.map((order) => {
      const chain = (deliveriesByOrder.get(order.id) ?? [])
        .slice()
        .sort((a, b) => a.submissionSeq - b.submissionSeq);
      const first = chain[0] ?? null;
      const last = chain[chain.length - 1] ?? null;
      return {
        orderId: order.id,
        deliveryStatus: order.deliveryStatus,
        hasDispute: disputedOrders.has(order.id),
        expectedDeliveryAt: expectedByTask.get(order.marketplaceTaskId) ?? null,
        firstSubmittedAt: first?.submittedAt ?? null,
        firstDeliveryStatus: first?.status ?? null,
        hadRevisionRequest: chain.some((d) => d.status === 'revision_requested'),
        lastDeliveryStatus: last?.status ?? null,
      };
    });
  }
}