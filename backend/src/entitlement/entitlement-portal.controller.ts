import { Body, Controller, Delete, Get, Post, Param, Query, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { EntitlementService } from './entitlement.service';
import { EntitlementPlan, EntitlementPlanModel } from './entitlement-plan.entity';
import { EntitlementPaymentOrder, EntitlementUsageRecord } from './entitlement-entities';
import { ContractError } from '../longtask/contract/errors';
import { UserLlmConfig } from './user-llm-config.entity';
import { encryptKey } from '../gateway/gateway-keys.service';

/** OneLLM 门户：引导用户购买 token 套餐并创建 key */
export const ONELLM_PORTAL_URL = 'https://onellm.opennotebook.chat/portal/home';

/**
 * 用户侧套餐门户（工作台「AI 订阅套餐」页数据面）。
 * org 口径：一个用户 = 一个 org（org_id = user.id，DR-12 一份套餐覆盖账号全部 Workspace）。
 * 与 HMAC 服务级 E1-E4（Console 调用）隔离，鉴权用平台用户 JWT。
 */
@Controller('api/v1/entitlement/portal')
@UseGuards(AuthGuard)
export class EntitlementPortalController {
  constructor(
    private readonly entitlementService: EntitlementService,
    @InjectRepository(EntitlementPlan)
    private readonly plansRepo: Repository<EntitlementPlan>,
    @InjectRepository(EntitlementPlanModel)
    private readonly planModelsRepo: Repository<EntitlementPlanModel>,
    @InjectRepository(EntitlementUsageRecord)
    private readonly usageRepo: Repository<EntitlementUsageRecord>,
    @InjectRepository(EntitlementPaymentOrder)
    private readonly paymentRepo: Repository<EntitlementPaymentOrder>,
    @InjectRepository(UserLlmConfig)
    private readonly llmConfigRepo: Repository<UserLlmConfig>,
  ) {}

  private orgId(req: RequestWithUser): string {
    return req.user?.id ?? '';
  }

  /** 可开通套餐列表（active，含模型目录摘要） */
  @Get('plans')
  async listPlans() {
    const plans = await this.plansRepo.find({ where: { status: 'active' }, order: { priceCents: 'ASC' } });
    const models = plans.length
      ? await this.planModelsRepo.find({ where: { planId: In(plans.map((p) => p.id)) } })
      : [];
    return {
      data: plans.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        period_days: p.periodDays,
        total_tokens: p.totalTokens,
        total_credits: p.totalCredits,
        max_runtime_instances: p.maxRuntimeInstances,
        price_cents: p.priceCents,
        models: models
          .filter((m) => m.planId === p.id)
          .map((m) => ({ model_id: m.modelId, tier: m.tier, model_type: m.modelType, flagship: m.flagship })),
      })),
    };
  }

  /** 我的订阅（未订阅返回 subscription: null） */
  @Get('my')
  async mySubscription(@Req() req: RequestWithUser) {
    try {
      return { subscription: await this.entitlementService.getPlan(this.orgId(req)) };
    } catch (err) {
      if (err instanceof ContractError && err.status === 404) {
        return { subscription: null };
      }
      throw err;
    }
  }

  /** 我的额度（token / credits / 免费信封 / 冻结） */
  @Get('my/quotas')
  async myQuotas(@Req() req: RequestWithUser) {
    try {
      return { quotas: await this.entitlementService.getQuota(this.orgId(req)) };
    } catch (err) {
      if (err instanceof ContractError && err.status === 404) {
        return { quotas: null };
      }
      throw err;
    }
  }

  /** 按天聚合表达式：SQLite 用 date(col,'localtime')，PG 用 AT TIME ZONE 转 date */
  private readonly usageDayExpr =
    process.env.DB_TYPE === 'sqlite'
      ? "date(r.created_at, 'localtime')"
      : "(r.created_at AT TIME ZONE 'Asia/Shanghai')::date";

  /** 我的用量账单（近 N 天滚动，按天聚合 + 汇总） */
  @Get('my/usage')
  async myUsage(@Req() req: RequestWithUser, @Query('days') days?: string) {
    const windowDays = Math.min(Math.max(Number.parseInt(days ?? '90', 10) || 90, 1), 365);
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const dayExpr = this.usageDayExpr;
    const rows = await this.usageRepo
      .createQueryBuilder('r')
      .select(dayExpr, 'day')
      .addSelect('COUNT(*)', 'requests')
      .addSelect('SUM(r.totalTokens)', 'tokens')
      .addSelect('SUM(r.credits)', 'credits')
      .addSelect('SUM(r.costCents)', 'cost_cents')
      .where('r.orgId = :orgId AND r.createdAt >= :since', { orgId: this.orgId(req), since })
      .groupBy(dayExpr)
      .orderBy(dayExpr, 'DESC')
      .getRawMany<{ day: string; requests: string; tokens: string | null; credits: string | null; cost_cents: string | null }>();
    const daily = rows.map((r) => ({
      day: r.day,
      requests: Number(r.requests),
      tokens: Number(r.tokens ?? 0),
      credits: Number(r.credits ?? 0),
      cost_cents: Number(r.cost_cents ?? 0),
    }));

    // 按模型聚合（展示每个模型的次数 / 输入 / 输出 / credits / 金额）
    const modelRows = await this.usageRepo
      .createQueryBuilder('r')
      .select('r.model', 'model')
      .addSelect('COUNT(*)', 'requests')
      .addSelect('SUM(r.inputTokens)', 'input_tokens')
      .addSelect('SUM(r.outputTokens)', 'output_tokens')
      .addSelect('SUM(r.totalTokens)', 'tokens')
      .addSelect('SUM(r.credits)', 'credits')
      .addSelect('SUM(r.costCents)', 'cost_cents')
      .where('r.orgId = :orgId AND r.createdAt >= :since', { orgId: this.orgId(req), since })
      .groupBy('r.model')
      .orderBy('tokens', 'DESC')
      .getRawMany<{
        model: string;
        requests: string;
        input_tokens: string | null;
        output_tokens: string | null;
        tokens: string | null;
        credits: string | null;
        cost_cents: string | null;
      }>();
    const models = modelRows.map((r) => ({
      model: r.model,
      requests: Number(r.requests),
      input_tokens: Number(r.input_tokens ?? 0),
      output_tokens: Number(r.output_tokens ?? 0),
      tokens: Number(r.tokens ?? 0),
      credits: Number(r.credits ?? 0),
      cost_cents: Number(r.cost_cents ?? 0),
    }));

    return {
      window_days: windowDays,
      summary: {
        requests: daily.reduce((s, d) => s + d.requests, 0),
        tokens: daily.reduce((s, d) => s + d.tokens, 0),
        credits: daily.reduce((s, d) => s + d.credits, 0),
        cost_cents: daily.reduce((s, d) => s + d.cost_cents, 0),
      },
      daily,
      models,
    };
  }

  /** 自助开通：仅免费套餐（price_cents=0，如公测体验版）；付费套餐走运营/支付版块 */
  @Post('my/subscribe')
  async subscribe(@Req() req: RequestWithUser, @Body() body: { plan_id?: string }) {
    if (!body?.plan_id) {
      throw new ContractError(400, 'VALIDATION_INVALID_PAYLOAD', 'plan_id is required');
    }
    const plan = await this.plansRepo.findOne({ where: { id: body.plan_id, status: 'active' } });
    if (!plan) {
      throw new ContractError(404, 'ENTITLEMENT_PLAN_NOT_FOUND', `plan not found: ${body.plan_id}`);
    }
    if (plan.priceCents > 0) {
      throw new ContractError(
        422,
        'SUBSCRIPTION_PAYMENT_REQUIRED',
        '付费套餐暂不支持自助开通，请通过运营开通（支付版块接入后开放自助购买）',
      );
    }
    const { subscription, plan: activated } = await this.entitlementService.activate(this.orgId(req), plan.code);
    return {
      subscription: {
        id: subscription.id,
        status: subscription.status,
        period_start: subscription.periodStart,
        period_end: subscription.periodEnd,
        plan: { id: activated.id, code: activated.code, name: activated.name },
      },
    };
  }

  // ---------- 支付（当前 channel=mock 模拟支付；支付版块接入后扩展渠道，单据结构不变） ----------

  /** 创建订阅支付单（付费套餐开通/升级） */
  @Post('my/payment-orders')
  async createPaymentOrder(@Req() req: RequestWithUser, @Body() body: { plan_id?: string }) {
    if (!body?.plan_id) {
      throw new ContractError(400, 'VALIDATION_INVALID_PAYLOAD', 'plan_id is required');
    }
    const plan = await this.plansRepo.findOne({ where: { id: body.plan_id, status: 'active' } });
    if (!plan) {
      throw new ContractError(404, 'ENTITLEMENT_PLAN_NOT_FOUND', `plan not found: ${body.plan_id}`);
    }
    if (plan.priceCents <= 0) {
      throw new ContractError(422, 'SUBSCRIPTION_FREE_PLAN', '免费套餐无需支付，请直接调用 my/subscribe 开通');
    }
    const order = await this.paymentRepo.save(
      this.paymentRepo.create({
        orgId: this.orgId(req),
        planId: plan.id,
        amountCents: plan.priceCents,
        status: 'pending',
        channel: 'mock',
      } as EntitlementPaymentOrder),
    );
    return {
      order_id: order.id,
      plan: { id: plan.id, code: plan.code, name: plan.name },
      amount_cents: plan.priceCents,
      channel: order.channel,
      status: order.status,
      /** mock 阶段提示：真实支付渠道接入后该字段移除 */
      mock_pay_url: `/api/v1/entitlement/portal/my/payment-orders/${order.id}/mock-pay`,
    };
  }

  /** 模拟支付成功并开通/升级套餐（mock 渠道专用） */
  @Post('my/payment-orders/:id/mock-pay')
  async mockPay(@Req() req: RequestWithUser, @Param('id') orderId: string) {
    const order = await this.paymentRepo.findOne({ where: { id: orderId, orgId: this.orgId(req) } });
    if (!order) {
      throw new ContractError(404, 'PAYMENT_ORDER_NOT_FOUND', `payment order not found: ${orderId}`);
    }
    if (order.status === 'paid') {
      throw new ContractError(409, 'PAYMENT_ORDER_ALREADY_PAID', '该支付单已支付');
    }
    if (order.status !== 'pending') {
      throw new ContractError(409, 'PAYMENT_ORDER_NOT_PAYABLE', `订单状态不可支付: ${order.status}`);
    }
    const plan = await this.plansRepo.findOne({ where: { id: order.planId, status: 'active' } });
    if (!plan) {
      throw new ContractError(404, 'ENTITLEMENT_PLAN_NOT_FOUND', `plan not found: ${order.planId}`);
    }

    // 已有生效订阅 → 升级（即时生效）；无订阅 → 开通
    let result: { subscription: { id: string; status: string; periodStart: Date; periodEnd: Date } | unknown; plan: EntitlementPlan };
    const hasSubscription = await this.entitlementService.getPlan(this.orgId(req)).then(() => true).catch((err) => {
      if (err instanceof ContractError && err.status === 404) return false;
      throw err;
    });
    if (hasSubscription) {
      result = await this.entitlementService.upgrade(this.orgId(req), plan.code);
    } else {
      result = await this.entitlementService.activate(this.orgId(req), plan.code);
    }

    order.status = 'paid';
    order.paidAt = new Date();
    order.channelTradeNo = `mock-${randomUUID()}`;
    await this.paymentRepo.save(order);

    const sub = result.subscription as { id: string; status: string; periodStart: Date; periodEnd: Date };
    return {
      order_id: order.id,
      amount_cents: order.amountCents,
      channel: order.channel,
      action: hasSubscription ? 'upgraded' : 'activated',
      subscription: {
        id: sub.id,
        status: sub.status,
        period_start: sub.periodStart,
        period_end: sub.periodEnd,
        plan: { id: plan.id, code: plan.code, name: plan.name },
      },
    };
  }

  /** 我的支付记录（近 20 条，运营对账口径） */
  @Get('my/payment-orders')
  async myPaymentOrders(@Req() req: RequestWithUser) {
    const orders = await this.paymentRepo.find({
      where: { orgId: this.orgId(req) },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    const planIds = [...new Set(orders.map((o) => o.planId))];
    const plans = planIds.length ? await this.plansRepo.find({ where: { id: In(planIds) } }) : [];
    const planMap = new Map(plans.map((p) => [p.id, p]));
    return {
      data: orders.map((o) => ({
        id: o.id,
        plan_name: planMap.get(o.planId)?.name ?? o.planId,
        amount_cents: o.amountCents,
        status: o.status,
        channel: o.channel,
        channel_trade_no: o.channelTradeNo,
        paid_at: o.paidAt,
        created_at: o.createdAt,
      })),
    };
  }

  // ---------- AI Token 配置（BYOK：平台不卖套餐，用户自带网关 key） ----------

  private llmConfigView(row: UserLlmConfig | null) {
    if (!row) return { configured: false, base_url: null, key_prefix: null, updated_at: null, onellm_portal_url: ONELLM_PORTAL_URL };
    return {
      configured: true,
      base_url: row.baseUrl,
      key_prefix: row.keyPrefix,
      updated_at: row.updatedAt,
      onellm_portal_url: ONELLM_PORTAL_URL,
    };
  }

  /** 我的 AI 网关配置（key 只回显掩码前缀） */
  @Get('my/llm-config')
  async getLlmConfig(@Req() req: RequestWithUser) {
    const row = await this.llmConfigRepo.findOne({ where: { orgId: this.orgId(req) } });
    return this.llmConfigView(row);
  }

  /** 保存 AI 网关配置（方案一自有网关 / 方案二 OneLLM 购买后回填，同一入口） */
  @Post('my/llm-config')
  async saveLlmConfig(
    @Req() req: RequestWithUser,
    @Body() body: { base_url?: string; api_key?: string },
  ) {
    const baseUrl = (body?.base_url ?? '').trim().replace(/\/+$/, '');
    const apiKey = (body?.api_key ?? '').trim();
    if (!baseUrl || !apiKey) {
      throw new ContractError(400, 'VALIDATION_INVALID_PAYLOAD', 'base_url 与 api_key 均必填');
    }
    if (!/^https?:\/\//i.test(baseUrl) || baseUrl.length > 255) {
      throw new ContractError(400, 'VALIDATION_INVALID_PAYLOAD', 'base_url 需为合法 http(s) 地址且不超过 255 字符');
    }
    if (apiKey.length < 8 || apiKey.length > 256) {
      throw new ContractError(400, 'VALIDATION_INVALID_PAYLOAD', 'api_key 长度需在 8~256 之间');
    }
    await this.llmConfigRepo.save({
      orgId: this.orgId(req),
      baseUrl,
      apiKeyEnc: encryptKey(apiKey),
      keyPrefix: apiKey.slice(0, 10),
    } as UserLlmConfig);
    const row = await this.llmConfigRepo.findOne({ where: { orgId: this.orgId(req) } });
    return this.llmConfigView(row);
  }

  /** 清除 AI 网关配置 */
  @Delete('my/llm-config')
  async deleteLlmConfig(@Req() req: RequestWithUser) {
    await this.llmConfigRepo.delete({ orgId: this.orgId(req) });
    return { configured: false, onellm_portal_url: ONELLM_PORTAL_URL };
  }
}
