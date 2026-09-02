import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  EntitlementCreditHold,
  EntitlementFreeGrant,
  EntitlementQuotaPeriod,
  EntitlementUsageRecord,
  OrgSubscription,
} from './entitlement-entities';
import {
  EntitlementPlan,
  EntitlementPlanModel,
} from './entitlement-plan.entity';
import { ContractError } from '../longtask/contract/errors';
import {
  catalogDenied,
  limitReached,
  planNotFound,
  quotaExhausted,
} from './entitlement-errors';

const UNLIMITED = -1;

/** 运营参数（PRD §4.6：免费额度数值与有效期配置化，不写死契约） */
const FREE_GRANT_TOKENS = Number(process.env.ENTITLEMENT_FREE_TOKENS ?? 1_000_000);
const FREE_GRANT_CREDITS = Number(process.env.ENTITLEMENT_FREE_CREDITS ?? 200);
const FREE_GRANT_VALID_DAYS = Number(process.env.ENTITLEMENT_FREE_VALID_DAYS ?? 90);
const DEFAULT_PLAN_CODE = process.env.ENTITLEMENT_DEFAULT_PLAN ?? 'free';

export type UsageIngestItem = {
  workspace_id: string;
  agent_run_id?: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_cents: number;
};

/**
 * AI 网关订阅权益计费服务（DR-12 平台侧承载）：
 * E1 套餐 / E2 目录 / E3 额度 / E4 用量账单 + 计量上报原子扣减 + 订阅升降级。
 * 权益校验键 = org_id；计量归集键 = workspace_id。
 */
@Injectable()
export class EntitlementService {
  constructor(
    @InjectRepository(EntitlementPlan)
    private readonly plansRepo: Repository<EntitlementPlan>,
    @InjectRepository(EntitlementPlanModel)
    private readonly planModelsRepo: Repository<EntitlementPlanModel>,
    @InjectRepository(OrgSubscription)
    private readonly subsRepo: Repository<OrgSubscription>,
    @InjectRepository(EntitlementQuotaPeriod)
    private readonly quotaRepo: Repository<EntitlementQuotaPeriod>,
    @InjectRepository(EntitlementFreeGrant)
    private readonly freeGrantRepo: Repository<EntitlementFreeGrant>,
    @InjectRepository(EntitlementCreditHold)
    private readonly creditHoldRepo: Repository<EntitlementCreditHold>,
    @InjectRepository(EntitlementUsageRecord)
    private readonly usageRepo: Repository<EntitlementUsageRecord>,
    private readonly dataSource: DataSource,
  ) {}

  // ---------- E1：当前订阅套餐 ----------

  async getPlan(orgId: string) {
    const { subscription, plan } = await this.getActiveSubscription(orgId);
    const freeGrant = await this.freeGrantRepo.findOne({ where: { orgId } });
    const freeRemaining = this.freeRemaining(freeGrant);
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      status: subscription.status,
      free_quota_remaining: freeRemaining,
      period_start: subscription.periodStart,
      period_end: subscription.periodEnd,
      reset_at: subscription.periodEnd,
    };
  }

  // ---------- E2：权益目录 ----------

  async getCatalog(orgId: string) {
    const { plan } = await this.getActiveSubscription(orgId);
    const models = await this.planModelsRepo.find({ where: { planId: plan.id } });
    return {
      models: models.map((m) => ({
        id: m.modelId,
        tier: m.tier,
        model_type: m.modelType,
        flagship: m.flagship,
      })),
      runtime_profiles: plan.runtimeProfiles,
      max_cloud_runtime_instances: plan.maxRuntimeInstances,
    };
  }

  // ---------- E3：额度状态（实时） ----------

  async getQuota(orgId: string) {
    const { subscription, plan } = await this.getActiveSubscription(orgId);
    const period = await this.ensureCurrentPeriod(subscription, plan);
    const freeGrant = await this.freeGrantRepo.findOne({ where: { orgId } });
    const paidRemaining =
      plan.totalTokens === UNLIMITED
        ? UNLIMITED
        : Number(period.totalTokens) - Number(period.usedTokens);
    const freeRemaining = this.freeRemaining(freeGrant);
    const remainingTokens =
      paidRemaining === UNLIMITED
        ? UNLIMITED
        : paidRemaining + Math.max(freeRemaining, 0);
    // credits 维度：媒体生成。可用额 = 总量 - 已用 - 冻结中（预扣费占用）
    const frozenCredits = await this.frozenCredits(orgId);
    const paidCreditsRemaining =
      plan.totalCredits === UNLIMITED
        ? UNLIMITED
        : Number(period.totalCredits) - Number(period.usedCredits);
    const freeCreditsRemaining = this.freeCreditsRemaining(freeGrant);
    const remainingCredits =
      paidCreditsRemaining === UNLIMITED
        ? UNLIMITED
        : paidCreditsRemaining + Math.max(freeCreditsRemaining, 0);
    return {
      exhausted: remainingTokens !== UNLIMITED && remainingTokens <= 0,
      remaining_tokens: remainingTokens,
      total_tokens: plan.totalTokens,
      used_tokens: Number(period.usedTokens),
      period_start: period.periodStart,
      period_end: period.periodEnd,
      remaining_credits: remainingCredits,
      total_credits: plan.totalCredits,
      used_credits: Number(period.usedCredits),
      frozen_credits: frozenCredits,
      available_credits:
        remainingCredits === UNLIMITED
          ? UNLIMITED
          : Math.max(remainingCredits - frozenCredits, 0),
      free_quota: {
        active: this.freeActive(freeGrant),
        remaining: freeRemaining,
        remaining_credits: freeCreditsRemaining,
        valid_until: freeGrant?.validUntil ?? null,
      },
    };
  }

  // ---------- E4：用量与账单（workspace 归集键 + 增量游标） ----------

  async getUsage(
    workspaceId: string,
    periodStart: Date,
    periodEnd: Date,
    cursor?: number,
    limit = 500,
  ) {
    const qb = this.usageRepo
      .createQueryBuilder('r')
      .where('r.workspace_id = :workspaceId', { workspaceId })
      .andWhere('r.created_at >= :periodStart', { periodStart })
      .andWhere('r.created_at < :periodEnd', { periodEnd })
      .orderBy('r.id', 'ASC')
      .take(limit);
    if (cursor) {
      qb.andWhere('r.id > :cursor', { cursor });
    }
    const items = await qb.getMany();
    const last = items.length ? items[items.length - 1].id : (cursor ?? 0);
    return {
      period: { start: periodStart, end: periodEnd },
      requests: items.length,
      input_tokens: items.reduce((s, r) => s + Number(r.inputTokens), 0),
      output_tokens: items.reduce((s, r) => s + Number(r.outputTokens), 0),
      credits: items.reduce((s, r) => s + Number(r.credits), 0),
      cost_cents: items.reduce((s, r) => s + Number(r.costCents), 0),
      cursor: String(last),
      items: items.map((r) => ({
        agent_run_id: r.agentRunId,
        model: r.model,
        usage_type: r.usageType,
        input_tokens: Number(r.inputTokens),
        output_tokens: Number(r.outputTokens),
        total_tokens: Number(r.totalTokens),
        credits: Number(r.credits),
        cost_cents: Number(r.costCents),
      })),
    };
  }

  // ---------- 计量上报：原子扣减（网关计量为权威，公测硬断） ----------

  async recordUsage(orgId: string, items: UsageIngestItem[]): Promise<{ recorded: number }> {
    if (!Array.isArray(items) || items.length === 0) {
      return { recorded: 0 };
    }
    const { subscription, plan } = await this.getActiveSubscription(orgId);
    const period = await this.ensureCurrentPeriod(subscription, plan);
    const freeGrant = await this.freeGrantRepo.findOne({ where: { orgId } });

    const totalDelta = items.reduce(
      (s, i) => s + Math.max(Number(i.total_tokens) || 0, 0),
      0,
    );
    // 扣减顺序：先免费额度（公测信封），后周期额度；不足即 4xx 业务态拒绝
    let remainingToDeduct = totalDelta;
    let freeDeduct = 0;
    if (freeGrant && this.freeActive(freeGrant)) {
      const freeLeft = Math.max(
        Number(freeGrant.totalTokens) - Number(freeGrant.usedTokens),
        0,
      );
      freeDeduct = Math.min(freeLeft, remainingToDeduct);
      remainingToDeduct -= freeDeduct;
    }
    if (
      plan.totalTokens !== UNLIMITED &&
      remainingToDeduct > Number(plan.totalTokens) - Number(period.usedTokens)
    ) {
      throw quotaExhausted(orgId);
    }

    await this.dataSource.transaction(async (em) => {
      for (const item of items) {
        await em.insert(EntitlementUsageRecord, {
          orgId,
          workspaceId: item.workspace_id,
          agentRunId: item.agent_run_id ?? null,
          model: item.model,
          inputTokens: Number(item.input_tokens) || 0,
          outputTokens: Number(item.output_tokens) || 0,
          totalTokens: Number(item.total_tokens) || 0,
          costCents: Number(item.cost_cents) || 0,
        });
      }
      if (plan.totalTokens !== UNLIMITED && remainingToDeduct > 0) {
        // 原子条件更新：used + delta <= total，避免并发 TOCTOU
        const res = await em
          .createQueryBuilder()
          .update(EntitlementQuotaPeriod)
          .set({ usedTokens: () => `"used_tokens" + ${Number(remainingToDeduct)}` })
          .where('id = :id AND "total_tokens" >= "used_tokens" + :delta', {
            id: period.id,
            delta: remainingToDeduct,
          })
          .execute();
        if (!res.affected) {
          throw quotaExhausted(orgId);
        }
      }
      if (freeDeduct > 0 && freeGrant) {
        await em
          .createQueryBuilder()
          .update(EntitlementFreeGrant)
          .set({ usedTokens: () => `"used_tokens" + ${Number(freeDeduct)}` })
          .where('id = :id AND "total_tokens" >= "used_tokens" + :delta', {
            id: freeGrant.id,
            delta: freeDeduct,
          })
          .execute();
      }
    });
    return { recorded: items.length };
  }

  // ---------- 媒体生成 credits 预扣费（OneLLM 冻结→结算/退款口径） ----------

  /**
   * 提交媒体任务时冻结预扣费：可用额（含冻结占用）不足即 402。
   * taskId 幂等：重复提交同一 OneLLM task 返回既有冻结单。
   */
  async holdCredits(
    orgId: string,
    input: {
      task_id: string;
      workspace_id: string;
      agent_run_id?: string | null;
      model: string;
      estimated_credits: number;
    },
  ): Promise<{ task_id: string; status: string; estimated_credits: number }> {
    const existing = await this.creditHoldRepo.findOne({
      where: { taskId: input.task_id },
    });
    if (existing) {
      return {
        task_id: existing.taskId,
        status: existing.status,
        estimated_credits: Number(existing.estimatedCredits),
      };
    }
    const { subscription, plan } = await this.getActiveSubscription(orgId);
    const period = await this.ensureCurrentPeriod(subscription, plan);
    const freeGrant = await this.freeGrantRepo.findOne({ where: { orgId } });
    const estimated = Math.max(Math.ceil(Number(input.estimated_credits) || 0), 0);
    if (plan.totalCredits !== UNLIMITED) {
      const frozen = await this.frozenCredits(orgId);
      const available =
        Number(period.totalCredits) -
        Number(period.usedCredits) +
        Math.max(this.freeCreditsRemaining(freeGrant), 0) -
        frozen;
      if (estimated > available) {
        throw quotaExhausted(orgId);
      }
    }
    await this.creditHoldRepo.save({
      orgId,
      taskId: input.task_id,
      workspaceId: input.workspace_id,
      agentRunId: input.agent_run_id ?? null,
      model: input.model,
      estimatedCredits: estimated,
      status: 'frozen',
    } as EntitlementCreditHold);
    return { task_id: input.task_id, status: 'frozen', estimated_credits: estimated };
  }

  /**
   * 终态结算（is_final=true 成功）：按实际费用入账，多退少补
   * （冻结未直接扣 used，结算只扣 actual）。
   */
  async settleHold(
    taskId: string,
    actualCredits: number,
    costCents = 0,
  ): Promise<{ task_id: string; status: string; settled_credits: number }> {
    const hold = await this.creditHoldRepo.findOne({ where: { taskId } });
    if (!hold) {
      throw new ContractError(404, 'NOT_FOUND', `credit hold not found: ${taskId}`);
    }
    if (hold.status !== 'frozen') {
      return { task_id: taskId, status: hold.status, settled_credits: Number(hold.settledCredits ?? 0) };
    }
    const actual = Math.max(Math.ceil(Number(actualCredits) || 0), 0);
    const { subscription, plan } = await this.getActiveSubscription(hold.orgId);
    const period = await this.ensureCurrentPeriod(subscription, plan);
    const freeGrant = await this.freeGrantRepo.findOne({
      where: { orgId: hold.orgId },
    });
    let freeDeduct = 0;
    let paidDeduct = actual;
    if (freeGrant && this.freeActive(freeGrant)) {
      freeDeduct = Math.min(this.freeCreditsRemaining(freeGrant), paidDeduct);
      paidDeduct -= freeDeduct;
    }
    await this.dataSource.transaction(async (em) => {
      if (plan.totalCredits !== UNLIMITED && paidDeduct > 0) {
        // 原子条件更新：used + delta <= total，防并发超扣
        const res = await em
          .createQueryBuilder()
          .update(EntitlementQuotaPeriod)
          .set({ usedCredits: () => `"used_credits" + ${Number(paidDeduct)}` })
          .where('id = :id AND "total_credits" >= "used_credits" + :delta', {
            id: period.id,
            delta: paidDeduct,
          })
          .execute();
        if (!res.affected) {
          throw quotaExhausted(hold.orgId);
        }
      }
      if (freeDeduct > 0 && freeGrant) {
        await em
          .createQueryBuilder()
          .update(EntitlementFreeGrant)
          .set({ usedCredits: () => `"used_credits" + ${Number(freeDeduct)}` })
          .where('id = :id AND "total_credits" >= "used_credits" + :delta', {
            id: freeGrant.id,
            delta: freeDeduct,
          })
          .execute();
      }
      await em.insert(EntitlementUsageRecord, {
        orgId: hold.orgId,
        workspaceId: hold.workspaceId,
        agentRunId: hold.agentRunId,
        model: hold.model,
        usageType: 'media',
        credits: actual,
        costCents: Number(costCents) || 0,
      });
      await em.update(
        EntitlementCreditHold,
        { id: hold.id },
        { status: 'settled', settledCredits: actual },
      );
    });
    return { task_id: taskId, status: 'settled', settled_credits: actual };
  }

  /** 终态失败：全额释放冻结额度，不扣费（refunded=true 幂等语义） */
  async refundHold(taskId: string): Promise<{ task_id: string; status: string }> {
    const hold = await this.creditHoldRepo.findOne({ where: { taskId } });
    if (!hold) {
      throw new ContractError(404, 'NOT_FOUND', `credit hold not found: ${taskId}`);
    }
    if (hold.status === 'frozen') {
      await this.creditHoldRepo.update({ id: hold.id }, { status: 'refunded' });
    }
    return { task_id: taskId, status: hold.status === 'frozen' ? 'refunded' : hold.status };
  }

  /** 幂等查询（对应 GET /v1/media/tasks/{task_id} 轮询语义） */
  async getHoldStatus(taskId: string) {
    const hold = await this.creditHoldRepo.findOne({ where: { taskId } });
    if (!hold) {
      throw new ContractError(404, 'NOT_FOUND', `credit hold not found: ${taskId}`);
    }
    return {
      task_id: hold.taskId,
      status: hold.status,
      estimated_credits: Number(hold.estimatedCredits),
      settled_credits: hold.settledCredits === null ? null : Number(hold.settledCredits),
    };
  }

  // ---------- 权益校验（四处强制校验点，B.6 语义） ----------

  async checkEntitlement(
    orgId: string,
    kind: 'runtime_instance' | 'model' | 'runtime_profile' | 'media_model',
    value: number | string,
  ): Promise<{ allowed: boolean }> {
    const { plan } = await this.getActiveSubscription(orgId);
    if (kind === 'runtime_instance') {
      const current = Number(value);
      if (
        plan.maxRuntimeInstances !== UNLIMITED &&
        current + 1 > plan.maxRuntimeInstances
      ) {
        throw limitReached(orgId);
      }
      return { allowed: true };
    }
    if (kind === 'runtime_profile') {
      if (plan.runtimeProfiles.includes('*')) return { allowed: true };
      if (!plan.runtimeProfiles.includes(String(value))) {
        throw catalogDenied(String(value));
      }
      return { allowed: true };
    }
    // model / media_model：目录内校验（媒体模型要求 model_type != chat）
    const models = await this.planModelsRepo.find({ where: { planId: plan.id } });
    const found = models.find((m) => m.modelId === String(value));
    if (!found) {
      throw catalogDenied(String(value));
    }
    if (kind === 'media_model' && found.modelType === 'chat') {
      throw catalogDenied(String(value));
    }
    return { allowed: true };
  }

  // ---------- 订阅生命周期（购买/升级/充值走平台侧界面） ----------

  /** 入驻激活（含公测免费额度即赠）；planCode 缺省用默认套餐 */
  async activate(orgId: string, planCode?: string) {
    const plan = await this.plansRepo.findOne({
      where: { code: planCode ?? DEFAULT_PLAN_CODE, status: 'active' },
    });
    if (!plan) throw planNotFound(orgId);

    const existing = await this.subsRepo.findOne({
      where: { orgId, status: In(['active', 'trial']) },
    });
    if (existing) return { subscription: existing, plan };

    const now = new Date();
    const periodEnd = new Date(now.getTime() + plan.periodDays * 86_400_000);
    const sub = await this.subsRepo.save({
      orgId,
      planId: plan.id,
      status: 'active',
      periodStart: now,
      periodEnd,
    } as OrgSubscription);
    if (plan.totalTokens !== UNLIMITED) {
      await this.quotaRepo.save({
        orgId,
        subscriptionId: sub.id,
        periodStart: now,
        periodEnd,
        totalTokens: plan.totalTokens,
        usedTokens: 0,
        totalCredits: plan.totalCredits,
        usedCredits: 0,
      } as EntitlementQuotaPeriod);
    }
    await this.issueFreeGrant(orgId);
    return { subscription: sub, plan };
  }

  /** 升级即时生效（周期内换套餐，used 保留；差价折算由结算版块承担） */
  async upgrade(orgId: string, planCode: string) {
    const plan = await this.plansRepo.findOne({
      where: { code: planCode, status: 'active' },
    });
    if (!plan) throw planNotFound(orgId);
    const { subscription } = await this.getActiveSubscription(orgId);
    subscription.planId = plan.id;
    subscription.pendingPlanId = null;
    await this.subsRepo.save(subscription);
    // 周期额度信封按新套餐总量重建（保留已用）
    const period = await this.ensureCurrentPeriod(subscription, plan);
    period.totalTokens = plan.totalTokens;
    period.totalCredits = plan.totalCredits;
    await this.dataSource
      .getRepository(EntitlementQuotaPeriod)
      .save(period);
    return { subscription, plan };
  }

  /** 降级：下个计费周期生效（记 pending，滚动时应用） */
  async downgrade(orgId: string, planCode: string) {
    const plan = await this.plansRepo.findOne({
      where: { code: planCode, status: 'active' },
    });
    if (!plan) throw planNotFound(orgId);
    const { subscription } = await this.getActiveSubscription(orgId);
    subscription.pendingPlanId = plan.id;
    await this.subsRepo.save(subscription);
    return { subscription, plan, effective_at: subscription.periodEnd };
  }

  // ---------- 内部 ----------

  private async getActiveSubscription(orgId: string): Promise<{
    subscription: OrgSubscription;
    plan: EntitlementPlan;
  }> {
    const subscription = await this.subsRepo.findOne({
      where: { orgId, status: In(['active', 'trial']) },
    });
    if (!subscription) throw planNotFound(orgId);
    const plan = await this.plansRepo.findOne({
      where: { id: subscription.planId },
    });
    if (!plan) throw planNotFound(orgId);
    return { subscription, plan };
  }

  /** 周期滚动（E1 ResetAt）：过期即新建周期应用 pending 降级 */
  private async ensureCurrentPeriod(
    subscription: OrgSubscription,
    plan: EntitlementPlan,
  ): Promise<EntitlementQuotaPeriod> {
    const now = new Date();
    let currentPlan = plan;
    if (subscription.pendingPlanId && subscription.periodEnd <= now) {
      const pending = await this.plansRepo.findOne({
        where: { id: subscription.pendingPlanId },
      });
      if (pending) {
        currentPlan = pending;
        subscription.planId = pending.id;
        subscription.pendingPlanId = null;
      }
    }
    if (subscription.periodEnd <= now) {
      const newStart = subscription.periodEnd;
      subscription.periodStart = newStart;
      subscription.periodEnd = new Date(
        newStart.getTime() + currentPlan.periodDays * 86_400_000,
      );
      await this.subsRepo.save(subscription);
    }
    const period = await this.quotaRepo.findOne({
      where: { subscriptionId: subscription.id },
      order: { periodEnd: 'DESC' },
    });
    if (period && period.periodEnd >= now) {
      if (
        currentPlan.totalTokens !== UNLIMITED &&
        Number(period.totalTokens) !== currentPlan.totalTokens
      ) {
        period.totalTokens = currentPlan.totalTokens;
        period.totalCredits = currentPlan.totalCredits;
        await this.quotaRepo.save(period);
      }
      return period;
    }
    if (currentPlan.totalTokens === UNLIMITED) {
      // 无限额度不建周期信封，直接返回虚拟周期
      return {
        id: '',
        orgId: subscription.orgId,
        subscriptionId: subscription.id,
        periodStart: subscription.periodStart,
        periodEnd: subscription.periodEnd,
        totalTokens: UNLIMITED,
        usedTokens: 0,
        totalCredits: UNLIMITED,
        usedCredits: 0,
        createdAt: now,
      } as EntitlementQuotaPeriod;
    }
    return this.quotaRepo.save({
      orgId: subscription.orgId,
      subscriptionId: subscription.id,
      periodStart: subscription.periodStart,
      periodEnd: subscription.periodEnd,
      totalTokens: currentPlan.totalTokens,
      usedTokens: 0,
      totalCredits: currentPlan.totalCredits,
      usedCredits: 0,
    } as EntitlementQuotaPeriod);
  }

  private freeActive(grant?: EntitlementFreeGrant | null): boolean {
    return !!grant && grant.validUntil > new Date();
  }

  private freeRemaining(grant?: EntitlementFreeGrant | null): number {
    if (!this.freeActive(grant) || !grant) return 0;
    return Math.max(
      Number(grant.totalTokens) - Number(grant.usedTokens),
      0,
    );
  }

  private freeCreditsRemaining(grant?: EntitlementFreeGrant | null): number {
    if (!this.freeActive(grant) || !grant) return 0;
    return Math.max(
      Number(grant.totalCredits) - Number(grant.usedCredits),
      0,
    );
  }

  private async frozenCredits(orgId: string): Promise<number> {
    const holds = await this.creditHoldRepo.find({
      where: { orgId, status: 'frozen' },
    });
    return holds.reduce((s, h) => s + Number(h.estimatedCredits), 0);
  }

  private async issueFreeGrant(orgId: string): Promise<void> {
    const existing = await this.freeGrantRepo.findOne({ where: { orgId } });
    if (existing) return; // 入驻即赠一次，不可转让/重复领取
    await this.freeGrantRepo.save({
      orgId,
      totalTokens: FREE_GRANT_TOKENS,
      usedTokens: 0,
      totalCredits: FREE_GRANT_CREDITS,
      usedCredits: 0,
      validUntil: new Date(Date.now() + FREE_GRANT_VALID_DAYS * 86_400_000),
    } as EntitlementFreeGrant);
  }
}
