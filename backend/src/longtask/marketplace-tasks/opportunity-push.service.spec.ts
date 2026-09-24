import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OpportunityPushService } from './opportunity-push.service';
import { MarketplaceTask } from './marketplace-task.entity';
import { OpportunityDispatch } from './opportunity-dispatch.entity';
import { Workspace } from '../workspaces/workspace.entity';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';

describe('OpportunityPushService（T8：Push 模式 + 投递幂等）', () => {
  let service: OpportunityPushService;

  const mockTasksRepo = { findOne: jest.fn() };
  const mockDispatchRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };
  const mockWorkspacesRepo = { find: jest.fn(), findOne: jest.fn() };
  const mockDispatcher = { enqueue: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpportunityPushService,
        { provide: getRepositoryToken(MarketplaceTask), useValue: mockTasksRepo },
        {
          provide: getRepositoryToken(OpportunityDispatch),
          useValue: mockDispatchRepo,
        },
        { provide: getRepositoryToken(Workspace), useValue: mockWorkspacesRepo },
        {
          provide: WebhookDispatcherService,
          useValue: mockDispatcher,
        },
      ],
    }).compile();
    service = module.get(OpportunityPushService);
  });

  it('只推送给类目匹配且接收推送的 active Workspace', async () => {
    mockTasksRepo.findOne.mockResolvedValue({
      id: 'task-1',
      status: 'open',
      bidRound: 1,
      categoryId: 'cat-web',
      title: '企业官网',
      budgetMinCny: null,
      budgetMaxCny: 10000,
      expiresAt: new Date(),
    } as MarketplaceTask);
    mockWorkspacesRepo.find.mockResolvedValue([
      { id: 'ws-1', categoryIds: ['cat-web'], displayStatus: 'active', receivePlatformPush: true },
      { id: 'ws-2', categoryIds: ['cat-data'], displayStatus: 'active', receivePlatformPush: true }, // 类目不匹配
      { id: 'ws-3', categoryIds: ['cat-web'], displayStatus: 'frozen', receivePlatformPush: true }, // 冻结
      { id: 'ws-4', categoryIds: ['cat-web'], displayStatus: 'active', receivePlatformPush: false }, // 关推送
    ] as Workspace[]);
    mockDispatchRepo.findOne.mockResolvedValue(null);
    mockDispatchRepo.create.mockImplementation((v) => v);
    mockDispatchRepo.save.mockImplementation((v) => ({ ...v, id: `log-${v.workspaceId}` }));

    const pushed = await service.pushTask('task-1');
    expect(pushed).toBe(1);
    expect(mockDispatcher.enqueue).toHaveBeenCalledTimes(1);
    const [eventType, url, payload, eventId] =
      mockDispatcher.enqueue.mock.calls[0];
    expect(eventType).toBe('opportunity.pushed');
    expect(url).toContain('/v1/webhooks/opportunity/pushed');
    // 契约 §9.1 信封结构
    expect(payload.event_id).toBe('log-ws-1');
    expect(payload.event_type).toBe('opportunity.pushed');
    expect(payload.event_version).toBe(1);
    expect(payload.source).toBe('marketplace');
    expect(payload.data.workspace_id).toBe('ws-1');
    expect(payload.data.opportunity_id).toBe('log-ws-1');
    expect(payload.data.source_type).toBe('platform_push');
    expect(payload.data.task_brief.title).toBe('企业官网');
    expect(payload.data.task_brief.budget_range).toEqual({ min: 0, max: 10000 });
    expect(eventId).toBe('log-ws-1'); // 投递日志行 id 作为稳定 event_id（payload.event_id 同值）
  });

  it('同轮已投过的 Workspace 跳过（幂等）', async () => {
    mockTasksRepo.findOne.mockResolvedValue({
      id: 'task-1',
      status: 'open',
      bidRound: 1,
      categoryId: 'cat-web',
      title: 't',
    } as MarketplaceTask);
    mockWorkspacesRepo.find.mockResolvedValue([
      { id: 'ws-1', categoryIds: ['cat-web'], displayStatus: 'active', receivePlatformPush: true },
    ] as Workspace[]);
    mockDispatchRepo.findOne.mockResolvedValue({ id: 'log-1' }); // 已投

    const pushed = await service.pushTask('task-1');
    expect(pushed).toBe(0);
    expect(mockDispatcher.enqueue).not.toHaveBeenCalled();
  });

  it('任务非 open → 422', async () => {
    mockTasksRepo.findOne.mockResolvedValue({
      id: 'task-1',
      status: 'closed',
      bidRound: 1,
      categoryId: 'cat-web',
    } as MarketplaceTask);
    await expect(service.pushTask('task-1')).rejects.toMatchObject({
      status: 422,
    });
  });

  it('任务不存在 → 404', async () => {
    mockTasksRepo.findOne.mockResolvedValue(null);
    await expect(service.pushTask('missing')).rejects.toMatchObject({
      status: 404,
    });
  });

  describe('inviteToTask 雇主邀约（任务页推荐列表「邀请竞标」）', () => {
    const openTask = {
      id: 'task-1',
      status: 'open',
      bidRound: 1,
      categoryId: 'cat-web',
      title: '企业官网',
    } as MarketplaceTask;
    const activeWs = {
      id: '11111111-1111-4111-8111-111111111111',
      name: '星辰 AI 工作室',
      categoryIds: ['cat-web'],
      capabilityTags: ['react'],
      displayStatus: 'active',
      receivePlatformPush: true,
      completedTasksCount: 12,
      avgRating: 4.7,
      onTimeRate: 0.93,
      disputeRate: 0.02,
      createdAt: new Date('2026-08-01T00:00:00Z'),
    } as unknown as Workspace;

    it('未投递过 → 新建投递日志并出站 opportunity.pushed（含推荐分）', async () => {
      mockTasksRepo.findOne.mockResolvedValue(openTask);
      mockWorkspacesRepo.findOne.mockResolvedValue(activeWs);
      mockDispatchRepo.findOne.mockResolvedValue(null);
      mockDispatchRepo.create.mockImplementation((v) => v);
      mockDispatchRepo.save.mockImplementation((v) => ({ ...v, id: 'log-invite' }));

      const result = await service.inviteToTask(openTask, '11111111-1111-4111-8111-111111111111');
      expect(result).toEqual({
        invited: true,
        alreadyInvited: false,
        opportunityId: 'log-invite',
        workspaceId: '11111111-1111-4111-8111-111111111111',
      });
      expect(mockDispatcher.enqueue).toHaveBeenCalledTimes(1);
      const [eventType, , payload, eventId] = mockDispatcher.enqueue.mock.calls[0];
      expect(eventType).toBe('opportunity.pushed');
      expect(payload.data.workspace_id).toBe('11111111-1111-4111-8111-111111111111');
      expect(payload.data.source_type).toBe('platform_push');
      expect(payload.data.match_score).toBeGreaterThan(0);
      expect(eventId).toBe('log-invite');
    });

    it('同轮已投递过 → 幂等返回 alreadyInvited，不重复出站', async () => {
      mockTasksRepo.findOne.mockResolvedValue(openTask);
      mockWorkspacesRepo.findOne.mockResolvedValue(activeWs);
      mockDispatchRepo.findOne.mockResolvedValue({ id: 'log-existing' });

      const result = await service.inviteToTask(openTask, '11111111-1111-4111-8111-111111111111');
      expect(result).toEqual({
        invited: false,
        alreadyInvited: true,
        opportunityId: 'log-existing',
        workspaceId: '11111111-1111-4111-8111-111111111111',
      });
      expect(mockDispatcher.enqueue).not.toHaveBeenCalled();
      expect(mockDispatchRepo.save).not.toHaveBeenCalled();
    });

    it('workspace 不存在 → 404', async () => {
      mockTasksRepo.findOne.mockResolvedValue(openTask);
      mockWorkspacesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.inviteToTask(openTask, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toMatchObject({
        status: 404,
      });
    });

    it('workspaceId 非 uuid → 400 VALIDATION_INVALID_PAYLOAD（不落 PG 22P02）', async () => {
      await expect(service.inviteToTask(openTask, 'not-a-uuid')).rejects.toMatchObject(
        {
          status: 400,
          errorCode: 'VALIDATION_INVALID_PAYLOAD',
        },
      );
      expect(mockWorkspacesRepo.findOne).not.toHaveBeenCalled();
    });

    it('workspace 非 active（冻结/暂停）→ 422', async () => {
      mockTasksRepo.findOne.mockResolvedValue(openTask);
      mockWorkspacesRepo.findOne.mockResolvedValue({
        ...activeWs,
        displayStatus: 'frozen',
      });
      await expect(service.inviteToTask(openTask, '11111111-1111-4111-8111-111111111111')).rejects.toMatchObject({
        status: 422,
      });
    });

    it('任务非 open → 422，不触发任何查询副作用', async () => {
      await expect(
        service.inviteToTask({ ...openTask, status: 'closed' } as MarketplaceTask, '11111111-1111-4111-8111-111111111111'),
      ).rejects.toMatchObject({ status: 422 });
      expect(mockWorkspacesRepo.findOne).not.toHaveBeenCalled();
    });
  });
});