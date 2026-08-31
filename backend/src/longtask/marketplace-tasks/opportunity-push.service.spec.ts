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
  const mockWorkspacesRepo = { find: jest.fn() };
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
    expect(payload.workspace_id).toBe('ws-1');
    expect(eventId).toBe('log-ws-1'); // 投递日志行 id 作为稳定 event_id
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
});