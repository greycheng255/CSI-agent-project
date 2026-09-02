import { EntitlementService } from './entitlement.service';
import {
  EntitlementCreditHold,
  EntitlementFreeGrant,
  EntitlementQuotaPeriod,
  EntitlementUsageRecord,
  OrgSubscription,
} from './entitlement-entities';
import { EntitlementPlan, EntitlementPlanModel } from './entitlement-plan.entity';

const DAY = 86_400_000;

function plan(over: Partial<EntitlementPlan> = {}): EntitlementPlan {
  return {
    id: 'plan-pro',
    code: 'pro',
    name: '专业版',
    status: 'active',
    periodDays: 30,
    totalTokens: 1_000,
    totalCredits: 100,
    maxRuntimeInstances: 3,
    runtimeProfiles: ['cpu-standard'],
    priceCents: 9900,
    ...over,
  } as EntitlementPlan;
}

function subscription(over: Partial<OrgSubscription> = {}): OrgSubscription {
  const now = new Date();
  return {
    id: 'sub-1',
    orgId: 'org-1',
    planId: 'plan-pro',
    status: 'active',
    periodStart: new Date(now.getTime() - 5 * DAY),
    periodEnd: new Date(now.getTime() + 25 * DAY),
    pendingPlanId: null,
    ...over,
  } as OrgSubscription;
}

function period(over: Partial<EntitlementQuotaPeriod> = {}): EntitlementQuotaPeriod {
  return {
    id: 'qp-1',
    orgId: 'org-1',
    subscriptionId: 'sub-1',
    periodStart: new Date(),
    periodEnd: new Date(Date.now() + 25 * DAY),
    totalTokens: 1_000,
    usedTokens: 0,
    totalCredits: 100,
    usedCredits: 0,
    createdAt: new Date(),
    ...over,
  } as EntitlementQuotaPeriod;
}

describe('EntitlementService（DR-12 AI 网关订阅权益计费）', () => {
  let service: EntitlementService;
  let plans: { findOne: jest.Mock; find: jest.Mock };
  let planModels: { find: jest.Mock };
  let subs: { findOne: jest.Mock; save: jest.Mock };
  let quota: { findOne: jest.Mock; save: jest.Mock };
  let freeGrants: { findOne: jest.Mock; save: jest.Mock };
  let creditHolds: { find: jest.Mock; findOne: jest.Mock; save: jest.Mock; update: jest.Mock };
  let usage: { createQueryBuilder: jest.Mock };
  let em: {
    insert: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
    getRepository: jest.Mock;
  };

  beforeEach(() => {
    plans = { findOne: jest.fn(), find: jest.fn() };
    planModels = { find: jest.fn() };
    subs = { findOne: jest.fn(), save: jest.fn((v) => v) };
    quota = { findOne: jest.fn(), save: jest.fn((v) => v) };
    freeGrants = { findOne: jest.fn(), save: jest.fn((v) => v) };
    creditHolds = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn((v) => ({ ...v, id: 'hold-1' })),
      update: jest.fn().mockResolvedValue({}),
    };
    usage = {
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    };
    em = {
      insert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      createQueryBuilder: jest.fn().mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      }),
      getRepository: jest.fn().mockReturnValue(quota),
    };
    service = new EntitlementService(
      plans as never,
      planModels as never,
      subs as never,
      quota as never,
      freeGrants as never,
      creditHolds as never,
      usage as never,
      { transaction: jest.fn().mockImplementation((cb) => cb(em)) } as never,
    );
  });

  describe('E1/E2/E3 数据面', () => {
    beforeEach(() => {
      const p = plan();
      subs.findOne.mockResolvedValue(subscription());
      plans.findOne.mockResolvedValue(p);
      quota.findOne.mockResolvedValue(period({ usedTokens: 200 }));
      freeGrants.findOne.mockResolvedValue({
        orgId: 'org-1',
        totalTokens: 500,
        usedTokens: 100,
        totalCredits: 50,
        usedCredits: 10,
        validUntil: new Date(Date.now() + 30 * DAY),
      } as EntitlementFreeGrant);
    });

    it('getPlan 返回 E1 契约形态', async () => {
      const result = await service.getPlan('org-1');
      expect(result).toMatchObject({
        id: 'plan-pro',
        code: 'pro',
        status: 'active',
        free_quota_remaining: 400,
        reset_at: expect.any(Date),
      });
    });

    it('getCatalog 返回 E2 目录', async () => {
      planModels.find.mockResolvedValue([
        { modelId: 'glm-4', tier: 'flagship', flagship: true },
      ] as EntitlementPlanModel[]);
      const catalog = await service.getCatalog('org-1');
      expect(catalog).toMatchObject({
        models: [{ id: 'glm-4', tier: 'flagship', flagship: true }],
        runtime_profiles: ['cpu-standard'],
        max_cloud_runtime_instances: 3,
      });
    });

    it('getQuota：paid 剩余 + 免费信封合并', async () => {
      const q = await service.getQuota('org-1');
      expect(q).toMatchObject({
        exhausted: false,
        remaining_tokens: 1_200, // 800 paid + 400 free
        used_tokens: 200,
        remaining_credits: 140, // 90 paid + 50 free
        total_credits: 100,
        used_credits: 0,
        frozen_credits: 0,
        available_credits: 140,
      });
      expect(q.free_quota).toMatchObject({ active: true, remaining: 400 });
    });

    it('无有效订阅 → 404 ENTITLEMENT_PLAN_NOT_FOUND', async () => {
      subs.findOne.mockResolvedValueOnce(null);
      await expect(service.getQuota('org-x')).rejects.toMatchObject({
        status: 404,
        errorCode: 'ENTITLEMENT_PLAN_NOT_FOUND',
      });
    });
  });

  describe('计量上报与原子扣减（公测硬断）', () => {
    beforeEach(() => {
      subs.findOne.mockResolvedValue(subscription());
      plans.findOne.mockResolvedValue(plan());
      quota.findOne.mockResolvedValue(period({ usedTokens: 900 })); // 剩 100
      freeGrants.findOne.mockResolvedValue({
        orgId: 'org-1',
        totalTokens: 500,
        usedTokens: 500,
        validUntil: new Date(Date.now() + 30 * DAY),
      } as EntitlementFreeGrant); // 免费额度已耗尽
    });

    it('超出剩余额度 → 402 ENTITLEMENT_QUOTA_EXHAUSTED', async () => {
      await expect(
        service.recordUsage('org-1', [
          {
            workspace_id: 'ws-1',
            model: 'glm-4',
            input_tokens: 50,
            output_tokens: 100,
            total_tokens: 150,
            cost_cents: 30,
          },
        ]),
      ).rejects.toMatchObject({
        status: 402,
        errorCode: 'ENTITLEMENT_QUOTA_EXHAUSTED',
      });
    });

    it('未超限 → 明细落库 + 原子条件扣减', async () => {
      const result = await service.recordUsage('org-1', [
        {
          workspace_id: 'ws-1',
          agent_run_id: 'run-1',
          model: 'glm-4',
          input_tokens: 40,
          output_tokens: 60,
          total_tokens: 100,
          cost_cents: 20,
        },
      ]);
      expect(result).toEqual({ recorded: 1 });
      expect(em.insert).toHaveBeenCalledWith(
        EntitlementUsageRecord,
        expect.objectContaining({ workspaceId: 'ws-1', agentRunId: 'run-1' }),
      );
      expect(em.createQueryBuilder().execute).toHaveBeenCalled();
    });

    it('免费额度有剩余时优先扣免费，再扣周期额度', async () => {
      freeGrants.findOne.mockResolvedValueOnce({
        orgId: 'org-1',
        totalTokens: 500,
        usedTokens: 450,
        validUntil: new Date(Date.now() + 30 * DAY),
      } as EntitlementFreeGrant);
      quota.findOne.mockResolvedValueOnce(period({ usedTokens: 950 })); // paid 剩 50
      const result = await service.recordUsage('org-1', [
        {
          workspace_id: 'ws-1',
          model: 'glm-4',
          input_tokens: 0,
          output_tokens: 80,
          total_tokens: 80,
          cost_cents: 16,
        },
      ]);
      expect(result).toEqual({ recorded: 1 });
      expect(em.insert).toHaveBeenCalled();
    });
  });

  describe('权益校验（四处校验点）', () => {
    beforeEach(() => {
      subs.findOne.mockResolvedValue(subscription());
      plans.findOne.mockResolvedValue(plan());
    });

    it('实例数超上限 → 403 ENTITLEMENT_LIMIT_REACHED', async () => {
      await expect(
        service.checkEntitlement('org-1', 'runtime_instance', 3),
      ).rejects.toMatchObject({
        status: 403,
        errorCode: 'ENTITLEMENT_LIMIT_REACHED',
      });
    });

    it('模型不在目录 → 403 ENTITLEMENT_CATALOG_DENIED', async () => {
      planModels.find.mockResolvedValue([
        { modelId: 'glm-4' },
      ] as EntitlementPlanModel[]);
      await expect(
        service.checkEntitlement('org-1', 'model', 'gpt-x'),
      ).rejects.toMatchObject({
        status: 403,
        errorCode: 'ENTITLEMENT_CATALOG_DENIED',
      });
      await expect(
        service.checkEntitlement('org-1', 'model', 'glm-4'),
      ).resolves.toEqual({ allowed: true });
    });

    it('runtime_profile 通配放行', async () => {
      plans.findOne.mockResolvedValueOnce(plan({ runtimeProfiles: ['*'] }));
      await expect(
        service.checkEntitlement('org-1', 'runtime_profile', 'gpu-large'),
      ).resolves.toEqual({ allowed: true });
    });
  });

  describe('订阅生命周期', () => {
    it('activate：创建订阅 + 周期信封 + 免费额度即赠', async () => {
      const p = plan();
      plans.findOne.mockResolvedValue(p);
      subs.findOne
        .mockResolvedValueOnce(null) // existing check
        .mockResolvedValue(subscription());
      freeGrants.findOne.mockResolvedValue(null);
      quota.save.mockImplementation((v) => ({ ...v, id: 'qp-new' }));
      subs.save.mockImplementation((v) => ({ ...v, id: 'sub-new' }));

      const result = await service.activate('org-1', 'pro');
      expect(result.subscription.id).toBe('sub-new');
      expect(quota.save).toHaveBeenCalledWith(
        expect.objectContaining({ totalTokens: 1_000 }),
      );
      expect(freeGrants.save).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org-1' }),
      );
    });

    it('downgrade：仅记 pending，下周期生效', async () => {
      const pro = plan();
      const lite = plan({ id: 'plan-lite', code: 'lite', totalTokens: 100 });
      const sub = subscription();
      subs.findOne.mockResolvedValue(sub);
      plans.findOne.mockImplementation((_w: unknown) => {
        const where = (_w as { where?: { code?: string } }).where;
        return Promise.resolve(where?.code === 'lite' ? lite : pro);
      });
      const result = await service.downgrade('org-1', 'lite');
      expect(result.subscription.pendingPlanId).toBe('plan-lite');
      expect(result.effective_at).toEqual(sub.periodEnd);
    });
  });

  describe('媒体生成 credits 预扣费（OneLLM 冻结→结算/退款）', () => {
    beforeEach(() => {
      subs.findOne.mockResolvedValue(subscription());
      plans.findOne.mockResolvedValue(plan()); // totalCredits: 100
      quota.findOne.mockResolvedValue(period({ usedCredits: 60 })); // paid 剩 40
      freeGrants.findOne.mockResolvedValue(null); // 无免费 credits
    });

    it('冻结：可用额足够 → 创建冻结单', async () => {
      const result = await service.holdCredits('org-1', {
        task_id: 'task-1',
        workspace_id: 'ws-1',
        model: 'grok-video-3',
        estimated_credits: 30,
      });
      expect(result).toEqual({ task_id: 'task-1', status: 'frozen', estimated_credits: 30 });
      expect(creditHolds.save).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-1', status: 'frozen' }),
      );
    });

    it('冻结：可用额不足（含冻结占用）→ 402', async () => {
      creditHolds.find.mockResolvedValue([
        { estimatedCredits: 30 },
        { estimatedCredits: 20 },
      ] as never); // 已冻结 50，可用 = 40 - 50 < 0
      await expect(
        service.holdCredits('org-1', {
          task_id: 'task-2',
          workspace_id: 'ws-1',
          model: 'grok-video-3',
          estimated_credits: 5,
        }),
      ).rejects.toMatchObject({ status: 402, errorCode: 'ENTITLEMENT_QUOTA_EXHAUSTED' });
    });

    it('冻结幂等：同 task_id 返回既有冻结单', async () => {
      creditHolds.findOne.mockResolvedValue({
        taskId: 'task-1',
        status: 'settled',
        estimatedCredits: 30,
        settledCredits: 22,
      } as EntitlementCreditHold);
      const result = await service.holdCredits('org-1', {
        task_id: 'task-1',
        workspace_id: 'ws-1',
        model: 'grok-video-3',
        estimated_credits: 30,
      });
      expect(result).toEqual({ task_id: 'task-1', status: 'settled', estimated_credits: 30 });
      expect(creditHolds.save).not.toHaveBeenCalled();
    });

    it('结算：按实际扣费入账 + 用量落库 + 状态更新', async () => {
      creditHolds.findOne.mockResolvedValue({
        id: 'hold-1',
        orgId: 'org-1',
        taskId: 'task-1',
        workspaceId: 'ws-1',
        agentRunId: null,
        model: 'grok-video-3',
        estimatedCredits: 30,
        settledCredits: null,
        status: 'frozen',
      } as EntitlementCreditHold);
      const result = await service.settleHold('task-1', 22, 44);
      expect(result).toEqual({ task_id: 'task-1', status: 'settled', settled_credits: 22 });
      expect(em.insert).toHaveBeenCalledWith(
        EntitlementUsageRecord,
        expect.objectContaining({ usageType: 'media', credits: 22 }),
      );
      expect(em.update).toHaveBeenCalledWith(
        EntitlementCreditHold,
        { id: 'hold-1' },
        { status: 'settled', settledCredits: 22 },
      );
    });

    it('退款：失败任务全额释放，不扣费', async () => {
      creditHolds.findOne.mockResolvedValue({
        id: 'hold-2',
        orgId: 'org-1',
        taskId: 'task-2',
        status: 'frozen',
        estimatedCredits: 30,
      } as EntitlementCreditHold);
      const result = await service.refundHold('task-2');
      expect(result).toEqual({ task_id: 'task-2', status: 'refunded' });
      expect(creditHolds.update).toHaveBeenCalledWith({ id: 'hold-2' }, { status: 'refunded' });
      expect(em.insert).not.toHaveBeenCalled();
    });
  });
});
