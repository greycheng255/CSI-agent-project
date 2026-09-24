import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkspaceRecommendService } from './workspace-recommend.service';
import { Workspace } from '../workspaces/workspace.entity';
import { MarketplaceBid } from '../marketplace-bids/marketplace-bid.entity';
import { OpportunityDispatch } from './opportunity-dispatch.entity';
import { MarketplaceTask } from './marketplace-task.entity';

describe('WorkspaceRecommendService（雇主创建任务后的工作室推荐）', () => {
  let service: WorkspaceRecommendService;

  const workspacesRepo = { find: jest.fn() };
  const bidsRepo = { find: jest.fn() };
  const dispatchRepo = { find: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceRecommendService,
        { provide: getRepositoryToken(Workspace), useValue: workspacesRepo },
        { provide: getRepositoryToken(MarketplaceBid), useValue: bidsRepo },
        { provide: getRepositoryToken(OpportunityDispatch), useValue: dispatchRepo },
      ],
    }).compile();
    service = module.get(WorkspaceRecommendService);
  });

  const task = {
    id: 'task-1',
    status: 'open',
    bidRound: 1,
    categoryId: 'cat-web',
    tags: ['react'],
    employerUserId: 'employer-1',
  } as MarketplaceTask;

  const row = (
    id: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    name: `WS-${id}`,
    slug: id,
    logoUrl: null,
    bio: null,
    categoryIds: ['cat-web'],
    capabilityTags: ['react'],
    displayStatus: 'active',
    receivePlatformPush: true,
    ownerUserId: `owner-${id}`,
    completedTasksCount: 12,
    avgRating: 4.7,
    onTimeRate: 0.93,
    disputeRate: 0,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  });

  it('按推荐分倒序，并排除已投标 / 雇主自有 / 关推送工作室', async () => {
    workspacesRepo.find.mockResolvedValue([
      row('ws-top'),
      row('ws-low', { completedTasksCount: 0, avgRating: 0, onTimeRate: 0 }),
      row('ws-bid'), // 已投标
      row('ws-self', { ownerUserId: 'employer-1' }), // 雇主自有
    ]);
    bidsRepo.find.mockResolvedValue([{ workspaceId: 'ws-bid' }]);
    dispatchRepo.find.mockResolvedValue([{ workspaceId: 'ws-top' }]);

    const result = await service.recommendForTask(task);
    expect(result.items.map((i) => i.workspaceId)).toEqual(['ws-top', 'ws-low']);
    expect(result.candidateCount).toBe(2);
    expect(result.items[0].invited).toBe(true); // 已收到平台邀约
    expect(result.items[1].invited).toBe(false);
    expect(result.items[0].credit).toEqual({
      completedTasksCount: 12,
      avgRating: 4.7,
      onTimeRate: 0.93,
      disputeRate: 0,
    });
    expect(result.items[0].matchScore).toBeGreaterThan(result.items[1].matchScore);
    expect(result.items[1].newShop).toBe(true); // 0 单 → 新店
  });

  it('limit 生效且被上限钳制（默认 6，最大 20）', async () => {
    workspacesRepo.find.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => row(`ws-${i}`, { completedTasksCount: 10 - i })),
    );
    bidsRepo.find.mockResolvedValue([]);
    dispatchRepo.find.mockResolvedValue([]);

    expect((await service.recommendForTask(task)).items).toHaveLength(6);
    expect((await service.recommendForTask(task, 3)).items).toHaveLength(3);
    expect((await service.recommendForTask(task, 99)).items).toHaveLength(10);
    expect((await service.recommendForTask(task, 0)).items).toHaveLength(6);
  });

  it('无候选（全部已投标）→ 空列表且候选数为 0', async () => {
    workspacesRepo.find.mockResolvedValue([row('ws-1')]);
    bidsRepo.find.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    dispatchRepo.find.mockResolvedValue([]);

    const result = await service.recommendForTask(task);
    expect(result.items).toEqual([]);
    expect(result.candidateCount).toBe(0);
  });
});