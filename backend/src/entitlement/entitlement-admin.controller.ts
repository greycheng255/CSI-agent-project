import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AdminGuard } from '../admin/admin.guard';
import { EntitlementService } from './entitlement.service';
import {
  EntitlementCreditHold,
  EntitlementFreeGrant,
  EntitlementQuotaPeriod,
  OrgSubscription,
} from './entitlement-entities';
import {
  EntitlementPlan,
  EntitlementPlanModel,
} from './entitlement-plan.entity';

export type PlanModelInput = {
  model_id: string;
  tier?: string | null;
  /** chat | image | video | audio | tts | music */
  model_type?: string;
  flagship?: boolean;
};

export type PlanInput = {
  code: string;
  name: string;
  period_days?: number;
  total_tokens?: number;
  /** 媒体生成周期 credits（-1 无限） */
  total_credits?: number;
  max_runtime_instances?: number;
  runtime_profiles?: string[];
  price_cents?: number;
  models?: PlanModelInput[];
};

/**
 * AI 网关套餐运营管理 API（开发计划 §4-P0 #7）。
 * 管理员侧：套餐 CRUD + 模型目录维护 + Org 订阅/额度查看。
 * 鉴权复用管理员会话（AdminGuard，Bearer adminToken）。
 */
@Controller('api/v1/admin/entitlement')
@UseGuards(AdminGuard)
export class EntitlementAdminController {
  constructor(
    private readonly entitlementService: EntitlementService,
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
  ) {}

  /** 套餐列表（含模型目录） */
  @Get('plans')
  async listPlans() {
    const plans = await this.plansRepo.find({ order: { createdAt: 'DESC' } });
    const models = plans.length
      ? await this.planModelsRepo.find({
          where: { planId: In(plans.map((p) => p.id)) },
        })
      : [];
    return {
      data: plans.map((p) => this.serializePlan(p, models.filter((m) => m.planId === p.id))),
    };
  }

  /** 创建套餐（含模型目录） */
  @Post('plans')
  async createPlan(@Body() body: PlanInput) {
    const plan = await this.plansRepo.save({
      code: body.code,
      name: body.name,
      status: 'active',
      periodDays: body.period_days ?? 30,
      totalTokens: body.total_tokens ?? -1,
      totalCredits: body.total_credits ?? -1,
      maxRuntimeInstances: body.max_runtime_instances ?? -1,
      runtimeProfiles: body.runtime_profiles ?? ['*'],
      priceCents: body.price_cents ?? 0,
    } as EntitlementPlan);
    const models = await this.replaceModels(plan.id, body.models ?? []);
    return { data: this.serializePlan(plan, models) };
  }

  /** 更新套餐（整体替换模型目录） */
  @Post('plans/:id/update')
  async updatePlan(@Param('id') id: string, @Body() body: PlanInput) {
    const plan = await this.plansRepo.findOne({ where: { id } });
    if (!plan) {
      return { error: 'plan not found' };
    }
    if (body.code !== undefined) plan.code = body.code;
    if (body.name !== undefined) plan.name = body.name;
    if (body.period_days !== undefined) plan.periodDays = body.period_days;
    if (body.total_tokens !== undefined) plan.totalTokens = body.total_tokens;
    if (body.total_credits !== undefined) plan.totalCredits = body.total_credits;
    if (body.max_runtime_instances !== undefined) {
      plan.maxRuntimeInstances = body.max_runtime_instances;
    }
    if (body.runtime_profiles !== undefined) {
      plan.runtimeProfiles = body.runtime_profiles;
    }
    if (body.price_cents !== undefined) plan.priceCents = body.price_cents;
    await this.plansRepo.save(plan);
    const models = await this.replaceModels(plan.id, body.models ?? []);
    return { data: this.serializePlan(plan, models) };
  }

  /** 停用套餐（软删除；存量订阅保留至周期结束） */
  @Post('plans/:id/deprecate')
  async deprecatePlan(@Param('id') id: string) {
    const plan = await this.plansRepo.findOne({ where: { id } });
    if (!plan) {
      return { error: 'plan not found' };
    }
    plan.status = 'deprecated';
    await this.plansRepo.save(plan);
    return { data: { id: plan.id, status: plan.status } };
  }

  /** Org 订阅列表（含额度周期与免费额度） */
  @Get('subscriptions')
  async listSubscriptions(@Query('status') status?: string) {
    const subs = await this.subsRepo.find({
      where: status ? { status: status as 'active' } : {},
      order: { createdAt: 'DESC' },
    });
    const plans = await this.plansRepo.find();
    const planById = new Map(plans.map((p) => [p.id, p]));
    const orgIds = [...new Set(subs.map((s) => s.orgId))];
    const periods = orgIds.length
      ? await this.quotaRepo
          .createQueryBuilder('q')
          .where('q.org_id IN (:...orgIds)', { orgIds })
          .orderBy('q.period_end', 'DESC')
          .getMany()
      : [];
    const grants = orgIds.length
      ? await this.freeGrantRepo
          .createQueryBuilder('g')
          .where('g.org_id IN (:...orgIds)', { orgIds })
          .getMany()
      : [];
    return {
      data: subs.map((s) => {
        const plan = planById.get(s.planId);
        const period = periods.find((q) => q.subscriptionId === s.id);
        const grant = grants.find((g) => g.orgId === s.orgId);
        return {
          id: s.id,
          org_id: s.orgId,
          status: s.status,
          plan_code: plan?.code ?? null,
          plan_name: plan?.name ?? null,
          pending_plan: s.pendingPlanId
            ? (planById.get(s.pendingPlanId)?.code ?? null)
            : null,
          period_start: s.periodStart,
          period_end: s.periodEnd,
          quota: period
            ? {
                total_tokens: Number(period.totalTokens),
                used_tokens: Number(period.usedTokens),
                total_credits: Number(period.totalCredits),
                used_credits: Number(period.usedCredits),
              }
            : null,
          free_quota: grant
            ? {
                total_tokens: Number(grant.totalTokens),
                used_tokens: Number(grant.usedTokens),
                total_credits: Number(grant.totalCredits),
                used_credits: Number(grant.usedCredits),
                valid_until: grant.validUntil,
              }
            : null,
        };
      }),
    };
  }

  // ---------- 订阅生命周期操作（运营侧） ----------

  /** 为 Org 激活订阅（含公测免费额度即赠） */
  @Post('subscriptions/activate')
  async activateSubscription(@Body() body: { org_id?: string; plan_code?: string }) {
    const result = await this.entitlementService.activate(
      body.org_id ?? '',
      body.plan_code,
    );
    return { data: { org_id: body.org_id, plan_code: result.plan.code } };
  }

  /** 升级（即时生效，差价折算由结算版块承担） */
  @Post('subscriptions/:id/upgrade')
  async upgradeSubscription(@Param('id') id: string, @Body() body: { plan_code?: string }) {
    const sub = await this.subsRepo.findOne({ where: { id } });
    if (!sub) return { error: 'subscription not found' };
    const result = await this.entitlementService.upgrade(
      sub.orgId,
      body.plan_code ?? '',
    );
    return { data: { org_id: sub.orgId, plan_code: result.plan.code } };
  }

  /** 降级（下个计费周期生效） */
  @Post('subscriptions/:id/downgrade')
  async downgradeSubscription(@Param('id') id: string, @Body() body: { plan_code?: string }) {
    const sub = await this.subsRepo.findOne({ where: { id } });
    if (!sub) return { error: 'subscription not found' };
    const result = await this.entitlementService.downgrade(
      sub.orgId,
      body.plan_code ?? '',
    );
    return {
      data: {
        org_id: sub.orgId,
        plan_code: result.plan.code,
        effective_at: result.effective_at,
      },
    };
  }

  // ---------- 预扣费冻结单管理（运营侧兜底对账） ----------

  /** 冻结单列表（默认 frozen 在前） */
  @Get('credit-holds')
  async listCreditHolds(
    @Query('status') status?: string,
    @Query('org_id') orgId?: string,
  ) {
    const qb = this.creditHoldRepo
      .createQueryBuilder('h')
      .orderBy('h.created_at', 'DESC')
      .take(100);
    if (status) qb.andWhere('h.status = :status', { status });
    if (orgId) qb.andWhere('h.org_id = :orgId', { orgId });
    const holds = await qb.getMany();
    return {
      data: holds.map((h) => ({
        task_id: h.taskId,
        org_id: h.orgId,
        workspace_id: h.workspaceId,
        agent_run_id: h.agentRunId,
        model: h.model,
        estimated_credits: Number(h.estimatedCredits),
        settled_credits: h.settledCredits === null ? null : Number(h.settledCredits),
        status: h.status,
        created_at: h.createdAt,
      })),
    };
  }

  /** 运营兜底结算（对账场景手动触发，幂等） */
  @Post('credit-holds/:taskId/settle')
  settleHold(
    @Param('taskId') taskId: string,
    @Body() body: { actual_credits?: number; cost_cents?: number },
  ) {
    return this.entitlementService.settleHold(
      taskId,
      Number(body.actual_credits ?? 0),
      Number(body.cost_cents ?? 0),
    );
  }

  /** 运营兜底退款（失败任务释放冻结） */
  @Post('credit-holds/:taskId/refund')
  refundHold(@Param('taskId') taskId: string) {
    return this.entitlementService.refundHold(taskId);
  }

  /** 用量查询（workspace 归集键 + 周期 + 增量游标，复用 E4） */
  @Get('workspaces/:workspaceId/usage')
  getUsage(
    @Param('workspaceId') workspaceId: string,
    @Query('period_start') periodStart: string,
    @Query('period_end') periodEnd: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.entitlementService.getUsage(
      workspaceId,
      new Date(periodStart),
      new Date(periodEnd),
      cursor ? Number(cursor) : undefined,
      limit ? Number(limit) : 500,
    );
  }

  // ---------- 内部 ----------

  private async replaceModels(planId: string, models: PlanModelInput[]) {
    await this.planModelsRepo.delete({ planId });
    if (!models.length) return [];
    const saved: EntitlementPlanModel[] = [];
    for (const m of models) {
      saved.push(
        await this.planModelsRepo.save({
          planId,
          modelId: m.model_id,
          tier: m.tier ?? null,
          modelType: m.model_type ?? 'chat',
          flagship: m.flagship ?? false,
        } as EntitlementPlanModel),
      );
    }
    return saved;
  }

  private serializePlan(plan: EntitlementPlan, models: EntitlementPlanModel[]) {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      status: plan.status,
      period_days: plan.periodDays,
      total_tokens: Number(plan.totalTokens),
      total_credits: Number(plan.totalCredits),
      max_runtime_instances: plan.maxRuntimeInstances,
      runtime_profiles: plan.runtimeProfiles,
      price_cents: Number(plan.priceCents),
      models: models.map((m) => ({
        model_id: m.modelId,
        tier: m.tier,
        model_type: m.modelType,
        flagship: m.flagship,
      })),
      created_at: plan.createdAt,
    };
  }
}
