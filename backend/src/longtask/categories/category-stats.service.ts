import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketplaceTask } from '../marketplace-tasks/marketplace-task.entity';
import { MarketplaceBid } from '../marketplace-bids/marketplace-bid.entity';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { OpportunityDispatch } from '../marketplace-tasks/opportunity-dispatch.entity';
import { Category } from './category.entity';

/**
 * 单类目运营统计（PRD 阶段二：类目下任务计数 + 运营报表）。
 */
export interface CategoryStats {
  category_id: string;
  name: string;
  slug: string;
  /** 任务总数（含所有状态） */
  task_count: number;
  /** 各状态任务数 */
  task_count_by_status: Record<string, number>;
  /** 投递商机总数（opportunity_dispatches 行数） */
  push_count: number;
  /** 竞标总数 */
  bid_count: number;
  /** 中标数（source=push 的 won bid 数，即平台推荐转化） */
  platform_push_won_count: number;
  /** 成交订单数 */
  order_count: number;
  /** 平均匹配度分数（仅 platform_push 投递，PRD §5.1） */
  avg_match_score: number | null;
}

/**
 * 类目统计服务（阶段二）。
 *
 * 职责：
 * - 单类目任务计数（含状态分布）
 * - 单类目运营报表（任务/投递/竞标/订单/平均匹配度）
 * - 全量类目运营报表（供超管后台）
 *
 * 只读查询，不修改任何实体；统计在数据库层 GROUP BY 完成。
 */
@Injectable()
export class CategoryStatsService {
  constructor(
    @InjectRepository(MarketplaceTask)
    private readonly tasksRepo: Repository<MarketplaceTask>,
    @InjectRepository(MarketplaceBid)
    private readonly bidsRepo: Repository<MarketplaceBid>,
    @InjectRepository(MarketplaceOrder)
    private readonly ordersRepo: Repository<MarketplaceOrder>,
    @InjectRepository(OpportunityDispatch)
    private readonly dispatchRepo: Repository<OpportunityDispatch>,
  ) {}

  /**
   * 单类目任务计数（PRD 阶段二「类目下任务计数」）。
   * 用于公开任务大厅的类目标签计数展示。
   */
  async getTaskCount(categoryId: string): Promise<{
    category_id: string;
    task_count: number;
    open_count: number;
  }> {
    const total = await this.tasksRepo.count({
      where: { categoryId },
    });
    const open = await this.tasksRepo.count({
      where: { categoryId, status: 'open' as any },
    });
    return {
      category_id: categoryId,
      task_count: total,
      open_count: open,
    };
  }

  /**
   * 批量任务计数（树形展示时一次拉取，避免 N+1）。
   * 返回 { [categoryId]: { task_count, open_count } }
   */
  async getTaskCountBatch(
    categoryIds: string[],
  ): Promise<
    Record<string, { task_count: number; open_count: number }>
  > {
    if (categoryIds.length === 0) return {};
    // 按 categoryId GROUP BY 一次拉取
    const rows = await this.tasksRepo
      .createQueryBuilder('t')
      .select('t.category_id', 'category_id')
      .addSelect('COUNT(*)', 'total')
      .addSelect(
        "SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END)",
        'open',
      )
      .where('t.category_id IN (:...ids)', { ids: categoryIds })
      .groupBy('t.category_id')
      .getRawMany<{ category_id: string; total: string; open: string }>();

    const result: Record<string, { task_count: number; open_count: number }> =
      {};
    for (const id of categoryIds) {
      result[id] = { task_count: 0, open_count: 0 };
    }
    for (const r of rows) {
      result[r.category_id] = {
        task_count: Number(r.total) || 0,
        open_count: Number(r.open) || 0,
      };
    }
    return result;
  }

  /**
   * 单类目运营报表（PRD 阶段二「类目运营报表」）。
   */
  async getStats(categoryId: string): Promise<CategoryStats | null> {
    // 任务总数 + 状态分布
    const statusRows = await this.tasksRepo
      .createQueryBuilder('t')
      .select('t.status', 'status')
      .addSelect('COUNT(*)', 'cnt')
      .where('t.category_id = :cid', { cid: categoryId })
      .groupBy('t.status')
      .getRawMany<{ status: string; cnt: string }>();
    const taskCountByStatus: Record<string, number> = {};
    let taskCount = 0;
    for (const r of statusRows) {
      taskCountByStatus[r.status] = Number(r.cnt) || 0;
      taskCount += Number(r.cnt) || 0;
    }

    // 投递数 + 平均匹配度（PRD §5.1）
    const pushRow = await this.dispatchRepo
      .createQueryBuilder('d')
      .select('COUNT(*)', 'cnt')
      .addSelect('AVG(d.match_score)', 'avg_score')
      .where('d.marketplace_task_id IN (SELECT id FROM marketplace_tasks WHERE category_id = :cid)', { cid: categoryId })
      .getRawOne<{ cnt: string | null; avg_score: string | null }>();
    const pushCount = Number(pushRow?.cnt) || 0;
    const avgScore = pushRow?.avg_score ? Number(pushRow.avg_score) : null;

    // 竞标数 + 平台推荐中标数
    const bidRow = await this.bidsRepo
      .createQueryBuilder('b')
      .select('COUNT(*)', 'total')
      .addSelect(
        "SUM(CASE WHEN b.source = 'push' AND b.status = 'won' THEN 1 ELSE 0 END)",
        'push_won',
      )
      .where('b.marketplace_task_id IN (SELECT id FROM marketplace_tasks WHERE category_id = :cid)', { cid: categoryId })
      .getRawOne<{ total: string | null; push_won: string | null }>();
    const bidCount = Number(bidRow?.total) || 0;
    const pushWonCount = Number(bidRow?.push_won) || 0;

    // 订单数
    const orderCount = await this.ordersRepo
      .createQueryBuilder('o')
      .where('o.marketplace_task_id IN (SELECT id FROM marketplace_tasks WHERE category_id = :cid)', { cid: categoryId })
      .getCount();

    // 类目基础信息
    const cat = await this.tasksRepo.manager.findOne(Category, {
      where: { id: categoryId },
    });
    if (!cat) return null;

    return {
      category_id: categoryId,
      name: cat.name,
      slug: cat.slug,
      task_count: taskCount,
      task_count_by_status: taskCountByStatus,
      push_count: pushCount,
      bid_count: bidCount,
      platform_push_won_count: pushWonCount,
      order_count: orderCount,
      avg_match_score: avgScore,
    };
  }

  /**
   * 全量类目运营报表（超管后台用）。
   * 返回每个类目（含 inactive）的简要统计。
   */
  async getReport(): Promise<
    Array<
      Pick<
        CategoryStats,
        | 'category_id'
        | 'name'
        | 'slug'
        | 'task_count'
        | 'push_count'
        | 'bid_count'
        | 'platform_push_won_count'
        | 'order_count'
        | 'avg_match_score'
      >
    >
  > {
    // 一次性 JOIN 聚合（按类目维度）
    const rows = await this.tasksRepo
      .createQueryBuilder('t')
      .select('t.category_id', 'category_id')
      .addSelect('COUNT(DISTINCT t.id)', 'task_count')
      .leftJoin('marketplace_bids', 'b', 'b.marketplace_task_id = t.id')
      .leftJoin(
        'opportunity_dispatches',
        'd',
        'd.marketplace_task_id = t.id',
      )
      .leftJoin(
        'marketplace_orders',
        'o',
        'o.marketplace_task_id = t.id',
      )
      .addSelect('COUNT(DISTINCT b.id)', 'bid_count')
      .addSelect(
        "SUM(CASE WHEN b.source = 'push' AND b.status = 'won' THEN 1 ELSE 0 END)",
        'push_won',
      )
      .addSelect('COUNT(DISTINCT d.id)', 'push_count')
      .addSelect('AVG(d.match_score)', 'avg_score')
      .addSelect('COUNT(DISTINCT o.id)', 'order_count')
      .where('t.category_id IS NOT NULL')
      .groupBy('t.category_id')
      .getRawMany<
        {
          category_id: string;
          task_count: string;
          bid_count: string;
          push_won: string;
          push_count: string;
          avg_score: string | null;
          order_count: string;
        }
      >();

    // 关联类目基础信息（含 inactive）
    const catIds = rows.map((r) => r.category_id);
    const cats: Category[] =
      catIds.length > 0
        ? await this.tasksRepo.manager.findByIds(Category, catIds)
        : [];
    const catMap = new Map(cats.map((c) => [c.id, c]));

    return rows.map((r) => ({
      category_id: r.category_id,
      name: catMap.get(r.category_id)?.name ?? '(unknown)',
      slug: catMap.get(r.category_id)?.slug ?? '(unknown)',
      task_count: Number(r.task_count) || 0,
      push_count: Number(r.push_count) || 0,
      bid_count: Number(r.bid_count) || 0,
      platform_push_won_count: Number(r.push_won) || 0,
      order_count: Number(r.order_count) || 0,
      avg_match_score: r.avg_score ? Number(r.avg_score) : null,
    }));
  }
}
