import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MarketplaceTask,
  MarketplaceTaskStatus,
} from './marketplace-task.entity';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';

export interface CreateMarketplaceTaskInput {
  employerUserId?: string | null;
  title: string;
  description?: string | null;
  categoryId?: string | null;
  budgetMinCny?: number | null;
  budgetMaxCny?: number | null;
  expectedDeliveryAt?: Date | string | null;
  attachmentUrls?: string[] | null;
  tags?: string[] | null;
  seatLimit?: number;
  ttlDays?: number;
}

const DEFAULT_SEAT_LIMIT = 20;
const DEFAULT_TTL_DAYS = 30;

/**
 * Marketplace Task 7 态状态机服务（PRD 附录 D.1）。
 * 转移边：
 *   draft→open（发布）；open→closed（雇主/平台关闭）；open→expired（有效期到）；
 *   open/selected→selected（选标）；open/selected→open（重开竞标，bid_round+1）；
 *   selected→completed / cancelled。
 */
@Injectable()
export class MarketplaceTasksService {
  constructor(
    @InjectRepository(MarketplaceTask)
    private readonly repo: Repository<MarketplaceTask>,
  ) {}

  async create(
    input: CreateMarketplaceTaskInput,
  ): Promise<MarketplaceTask> {
    const seatLimit = input.seatLimit ?? DEFAULT_SEAT_LIMIT;
    if (!Number.isInteger(seatLimit) || seatLimit < 1) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        'seat_limit must be a positive integer',
      );
    }
    const entity = this.repo.create({
      employerUserId: input.employerUserId ?? null,
      title: input.title,
      description: input.description ?? null,
      categoryId: input.categoryId ?? null,
      budgetMinCny: input.budgetMinCny ?? null,
      budgetMaxCny: input.budgetMaxCny ?? null,
      expectedDeliveryAt: input.expectedDeliveryAt
        ? new Date(input.expectedDeliveryAt)
        : null,
      attachmentUrls: input.attachmentUrls ?? null,
      tags: input.tags ?? null,
      status: 'draft',
      seatLimit,
      seatTaken: 0,
      bidRound: 1,
    });
    return this.repo.save(entity);
  }

  /** 发布：draft → open，写入有效期（默认 30 天，可配置） */
  async publish(id: string, ttlDays?: number): Promise<MarketplaceTask> {
    const task = await this.getOrThrow(id);
    if (task.status !== 'draft') {
      throw this.invalidTransition(task.status, 'draft', 'publish');
    }
    task.status = 'open';
    task.expiresAt = new Date(
      Date.now() + (ttlDays ?? DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000,
    );
    return this.repo.save(task);
  }

  /** 雇主/平台关闭：open → closed */
  async close(id: string): Promise<MarketplaceTask> {
    const task = await this.getOrThrow(id);
    if (task.status !== 'open') {
      throw this.invalidTransition(task.status, 'open', 'close');
    }
    task.status = 'closed';
    return this.repo.save(task);
  }

  /** 自然过期：open → expired（到期未选标） */
  async expire(id: string): Promise<MarketplaceTask> {
    const task = await this.getOrThrow(id);
    if (task.status !== 'open') {
      throw this.invalidTransition(task.status, 'open', 'expire');
    }
    task.status = 'expired';
    return this.repo.save(task);
  }

  /** 选标：open → selected */
  async select(id: string): Promise<MarketplaceTask> {
    const task = await this.getOrThrow(id);
    if (task.status !== 'open') {
      throw this.invalidTransition(task.status, 'open', 'select');
    }
    task.status = 'selected';
    return this.repo.save(task);
  }

  /** 重开竞标：open/selected → open；bid_round+1、席位与倒计时归档清零 */
  async reopenBidding(id: string): Promise<MarketplaceTask> {
    const task = await this.getOrThrow(id);
    if (task.status !== 'open' && task.status !== 'selected') {
      throw this.invalidTransition(task.status, 'open/selected', 'reopen');
    }
    task.status = 'open';
    task.bidRound += 1;
    task.seatTaken = 0;
    task.seatFullDeadline = null;
    task.seatFullLockedAt = null;
    task.lastReopenedAt = new Date();
    return this.repo.save(task);
  }

  /** 完成：selected → completed */
  async complete(id: string): Promise<MarketplaceTask> {
    const task = await this.getOrThrow(id);
    if (task.status !== 'selected') {
      throw this.invalidTransition(task.status, 'selected', 'complete');
    }
    task.status = 'completed';
    return this.repo.save(task);
  }

  /** 取消：selected → cancelled（Spec 超时 / 协商取消等） */
  async cancel(id: string): Promise<MarketplaceTask> {
    const task = await this.getOrThrow(id);
    if (task.status !== 'selected') {
      throw this.invalidTransition(task.status, 'selected', 'cancel');
    }
    task.status = 'cancelled';
    return this.repo.save(task);
  }

  findById(id: string): Promise<MarketplaceTask | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** 招投标中任务列表（供 C→M Pull 与大厅展示；阶段二接入） */
  findOpen(): Promise<MarketplaceTask[]> {
    return this.repo.find({ where: { status: 'open' as MarketplaceTaskStatus } });
  }

  /**
   * C→M Pull（契约 §9.2）：响应为包装对象 { tasks, next_cursor, has_more }，
   * task 字段按契约 snake_case 命名（task_id/budget_range/current_seats 等）。
   * Console 侧 Go 严格反序列化 listTasksResponse——裸数组会直接解析失败。
   * cursor 分页联调期未启用：next_cursor 恒 null、has_more 恒 false（字段按契约恒出现）。
   */
  async pullTasks(query: {
    category?: string;
    status?: string;
    bid_round?: string;
    since?: string;
    limit?: string;
    cursor?: string;
  }): Promise<{
    tasks: Array<Record<string, unknown>>;
    next_cursor: string | null;
    has_more: boolean;
  }> {
    const where: { status: MarketplaceTaskStatus } = {
      status: (query.status ?? 'open') as MarketplaceTaskStatus,
    };
    const categories = query.category
      ? query.category.split(',').map((c) => c.trim()).filter(Boolean)
      : null;

    const rows = await this.repo.find({ where });
    const sinceMs = query.since ? Date.parse(query.since) : NaN;
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

    const mapped = rows
      .filter((t) => !categories || categories.includes(t.categoryId ?? ''))
      .filter(
        (t) =>
          Number.isNaN(sinceMs) ||
          t.updatedAt.getTime() > sinceMs ||
          t.createdAt.getTime() > sinceMs,
      )
      .slice(0, limit)
      .map((t) => ({
        task_id: t.id,
        title: t.title,
        description: t.description,
        category: t.categoryId,
        budget_range: { min: t.budgetMinCny, max: t.budgetMaxCny },
        expected_delivery_date: t.expectedDeliveryAt,
        seat_limit: t.seatLimit,
        current_seats: t.seatTaken,
        bid_round: t.bidRound,
        attachments: (t.attachmentUrls ?? []).map((url) => ({ url })),
        published_at: t.createdAt,
        expires_at: t.expiresAt,
      }));

    return { tasks: mapped, next_cursor: null, has_more: false };
  }

  private async getOrThrow(id: string): Promise<MarketplaceTask> {
    const task = await this.repo.findOne({ where: { id } });
    if (!task) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_TASK,
        `marketplace task not found: ${id}`,
      );
    }
    return task;
  }

  private invalidTransition(
    from: string,
    fromExpected: string,
    action: string,
  ): ContractError {
    return new ContractError(
      422,
      CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION,
      `invalid transition for action '${action}': expected status in [${fromExpected}], got '${from}'`,
    );
  }
}