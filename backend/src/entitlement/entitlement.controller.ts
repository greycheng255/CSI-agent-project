import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HmacGuard } from '../longtask/contract/hmac.guard';
import { ContractError } from '../longtask/contract/errors';
import { decryptKey } from '../gateway/gateway-keys.service';
import { EntitlementService, UsageIngestItem } from './entitlement.service';
import { UserLlmConfig } from './user-llm-config.entity';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** org_id 入参必须是 UUID，否则返回 400（避免 PG uuid 解析炸成 500） */
function requireUuid(value: string, field = 'org_id'): string {
  if (!value || !UUID_RE.test(value)) {
    throw new ContractError(400, 'INVALID_ARGUMENT', `${field} must be a valid UUID`);
  }
  return value;
}

/**
 * AI 网关订阅权益计费 API（DR-12 平台侧）。
 * E1-E4 数据面 + 计量上报 + 权益校验 + 订阅生命周期（购买/升级/充值走平台侧界面）。
 * 鉴权复用长任务契约 HMAC（B.toml 共享密钥）；错误统一 RFC 7807（B.6 错误码族）。
 */
@Controller('v1/entitlement')
@UseGuards(HmacGuard)
export class EntitlementController {
  constructor(
    private readonly service: EntitlementService,
    @InjectRepository(UserLlmConfig)
    private readonly llmConfigRepo: Repository<UserLlmConfig>,
  ) {}

  /** E1：当前订阅套餐（Console /settings/billing + Pre-dispatch） */
  @Get('plans/:orgId')
  getPlan(@Param('orgId') orgId: string) {
    return this.service.getPlan(requireUuid(orgId));
  }

  /** E1 契约别名：GET /v1/entitlement/plan?org_id= */
  @Get('plan')
  getPlanByQuery(@Query('org_id') orgId: string) {
    return this.service.getPlan(requireUuid(orgId));
  }

  /** E2：权益目录（Console 侧可缓存 TTL ≤ 5min） */
  @Get('catalogs/:orgId')
  getCatalog(@Param('orgId') orgId: string) {
    return this.service.getCatalog(requireUuid(orgId));
  }

  /** E2 契约别名：GET /v1/entitlement/catalog?org_id= */
  @Get('catalog')
  getCatalogByQuery(@Query('org_id') orgId: string) {
    return this.service.getCatalog(requireUuid(orgId));
  }

  /** E3：额度状态（必须实时查询，不可缓存） */
  @Get('quotas/:orgId')
  getQuota(@Param('orgId') orgId: string) {
    return this.service.getQuota(requireUuid(orgId));
  }

  /** E3 契约别名：GET /v1/entitlement/quota?org_id= */
  @Get('quota')
  getQuotaByQuery(@Query('org_id') orgId: string) {
    return this.service.getQuota(requireUuid(orgId));
  }

  /** E4：用量与账单（workspace 归集键 + 增量游标续传） */
  @Get('workspaces/:workspaceId/usage')
  getUsage(
    @Param('workspaceId') workspaceId: string,
    @Query('period_start') periodStart: string,
    @Query('period_end') periodEnd: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getUsage(
      requireUuid(workspaceId, 'workspace_id'),
      new Date(periodStart),
      new Date(periodEnd),
      cursor ? Number(cursor) : undefined,
      limit ? Number(limit) : 500,
    );
  }

  /** E4 契约别名：GET /v1/entitlement/usage?workspace_id=&period_start=&period_end= */
  @Get('usage')
  getUsageByQuery(
    @Query('workspace_id') workspaceId: string,
    @Query('period_start') periodStart: string,
    @Query('period_end') periodEnd: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getUsage(
      requireUuid(workspaceId, 'workspace_id'),
      new Date(periodStart),
      new Date(periodEnd),
      cursor ? Number(cursor) : undefined,
      limit ? Number(limit) : 500,
    );
  }

  /**
   * E4 org 级批量用量（§4.2）：GET /v1/entitlement/orgs/:orgId/usage
   * 一次返回该 org 下全部 workspace（含无活动）的用量汇总，供对账扫描 O(org)/小时。
   */
  @Get('orgs/:orgId/usage')
  getUsageForOrg(
    @Param('orgId') orgId: string,
    @Query('period_start') periodStart: string,
    @Query('period_end') periodEnd: string,
  ) {
    return this.service.getUsageForOrg(
      requireUuid(orgId),
      new Date(periodStart),
      new Date(periodEnd),
    );
  }

  /** E5：能力声明（接入自检） */
  @Get('capabilities')
  getCapabilities() {
    return {
      version: '1.0.0',
      features: {
        incremental_usage_cursor: true,
        run_level_usage: true,
        free_quota_activation: true,
        workspace_level_keys: true,
        byok: true,
      },
    };
  }

  /** E6：公测免费额度激活（入驻即赠，幂等） */
  @Post('free-quota/activate')
  async activateFreeQuota(@Body() body: { org_id?: string }) {
    const orgId = requireUuid(body?.org_id ?? '');
    const { subscription, plan } = await this.service.activate(orgId);
    return {
      org_id: orgId,
      plan_code: plan.code,
      plan_name: plan.name,
      status: subscription.status,
      free_quota: {
        tokens: Number(process.env.ENTITLEMENT_FREE_TOKENS ?? 1_000_000),
        credits: Number(process.env.ENTITLEMENT_FREE_CREDITS ?? 200),
        valid_days: Number(process.env.ENTITLEMENT_FREE_VALID_DAYS ?? 90),
      },
    };
  }

  /** 计量上报（网关权威计量 → 平台原子扣减；公测硬断 402） */
  @Post('usage-records')
  recordUsage(@Body() body: { org_id?: string; items?: UsageIngestItem[] }) {
    return this.service.recordUsage(body.org_id ?? '', body.items ?? []);
  }

  /**
   * E7：用户 AI 网关凭证数据面（BYOK，服务级通道）。
   * Console 执行引擎按 org 拉取用户配置的网关地址与 API Key（明文，仅 HMAC 通道可取）。
   * 2026-09-07 加固：decryptKey 异常（脏数据/密钥轮换过渡期）→ 502 而非 500，便于 Console 重试。
   */
  @Get('llm-config/:orgId')
  async llmConfig(@Param('orgId') orgId: string) {
    const org = requireUuid(orgId);
    const row = await this.llmConfigRepo.findOne({ where: { orgId: org } });
    if (!row) {
      throw new ContractError(404, 'LLM_CONFIG_MISSING', `no llm config for org ${orgId}`);
    }
    if (!row.apiKeyEnc) {
      throw new ContractError(
        422,
        'LLM_CONFIG_INVALID',
        `llm config for org ${orgId} has no encrypted api key`,
      );
    }
    let apiKey: string;
    try {
      apiKey = decryptKey(row.apiKeyEnc);
    } catch (err) {
      throw new ContractError(
        502,
        'LLM_CONFIG_DECRYPT_FAILED',
        `failed to decrypt api key for org ${orgId}: ${(err as Error).message}`,
      );
    }
    return {
      org_id: orgId,
      base_url: row.baseUrl,
      api_key: apiKey,
      key_prefix: row.keyPrefix,
    };
  }

  /** 权益校验点：runtime_instance 数上限 / model 目录 / media_model 媒体模型目录 / runtime_profile 目录 */
  @Post('checks')
  check(
    @Body()
    body: {
      org_id?: string;
      kind?: 'runtime_instance' | 'model' | 'runtime_profile' | 'media_model';
      value?: number | string;
    },
  ) {
    return this.service.checkEntitlement(
      body.org_id ?? '',
      body.kind ?? 'model',
      body.value ?? '',
    );
  }

  /**
   * 媒体生成 credits 预扣费冻结（OneLLM 提交媒体任务时调用）。
   * 对应 /v1/media/generations 提交时冻结 estimated_cost；402 = 积分不足。
   */
  @Post('credit-holds')
  holdCredits(
    @Body()
    body: {
      org_id?: string;
      task_id?: string;
      workspace_id?: string;
      agent_run_id?: string | null;
      model?: string;
      estimated_credits?: number;
    },
  ) {
    return this.service.holdCredits(body.org_id ?? '', {
      task_id: body.task_id ?? '',
      workspace_id: body.workspace_id ?? '',
      agent_run_id: body.agent_run_id ?? null,
      model: body.model ?? '',
      estimated_credits: Number(body.estimated_credits ?? 0),
    });
  }

  /** 终态结算（is_final=true 成功）：按实际 cost 入账，多退少补 */
  @Post('credit-holds/:taskId/settle')
  settleHold(
    @Param('taskId') taskId: string,
    @Body() body: { actual_credits?: number; cost_cents?: number },
  ) {
    return this.service.settleHold(
      taskId,
      Number(body.actual_credits ?? 0),
      Number(body.cost_cents ?? 0),
    );
  }

  /** 终态失败：全额释放冻结额度（refunded） */
  @Post('credit-holds/:taskId/refund')
  refundHold(@Param('taskId') taskId: string) {
    return this.service.refundHold(taskId);
  }

  /** 幂等查询冻结单状态（对应 GET /v1/media/tasks/{task_id}） */
  @Get('credit-holds/:taskId')
  getHold(@Param('taskId') taskId: string) {
    return this.service.getHoldStatus(taskId);
  }

  /** 订阅生命周期：激活（含免费额度即赠）/ 升级即时 / 降级下周期 */
  @Post('subscriptions')
  lifecycle(
    @Body()
    body: {
      action?: 'activate' | 'upgrade' | 'downgrade';
      org_id?: string;
      plan_code?: string;
    },
  ) {
    const orgId = body.org_id ?? '';
    const planCode = body.plan_code;
    if (body.action === 'upgrade') {
      return this.service.upgrade(orgId, planCode ?? '');
    }
    if (body.action === 'downgrade') {
      return this.service.downgrade(orgId, planCode ?? '');
    }
    return this.service.activate(orgId, planCode);
  }
}
