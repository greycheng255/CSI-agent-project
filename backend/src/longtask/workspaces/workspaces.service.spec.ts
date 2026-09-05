import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkspacesService } from './workspaces.service';
import { Workspace } from './workspace.entity';
import { ContractError } from '../contract/errors';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';

describe('WorkspacesService（T1：展示页/投递/竞标主体投影）', () => {
  let service: WorkspacesService;
  const dispatcherMock = { recordInbound: jest.fn() };

  const mockRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    dispatcherMock.recordInbound.mockResolvedValue(true);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspacesService,
        { provide: getRepositoryToken(Workspace), useValue: mockRepo },
        {
          provide: WebhookDispatcherService,
          useValue: dispatcherMock,
        },
      ],
    }).compile();
    service = module.get(WorkspacesService);
  });

  it('创建成功（slug 不存在且无冲突）', async () => {
    mockRepo.findOne.mockResolvedValueOnce(null);
    mockRepo.create.mockImplementation((v) => v);
    mockRepo.save.mockImplementation((v) => v);

    const ws = await service.create({
      ownerUserId: 'user-1',
      name: 'AI 工作室',
      slug: 'studio-a',
      capabilityTags: ['电商文案', 'SaaS 官网'],
    });
    expect(ws.slug).toBe('studio-a');
    expect(ws.displayStatus).toBe('active');
    expect(ws.ownerUserId).toBe('user-1'); // 归属既有用户（改造语义）
  });

  it('按归属用户查询工作室', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ id: 'w1', ownerUserId: 'user-1' });
    const ws = await service.findByOwner('user-1');
    expect(ws?.ownerUserId).toBe('user-1');
    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { ownerUserId: 'user-1' },
    });
  });

  it('slug 重复 → 409 CONFLICT_WORKSPACE_SLUG', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 'w1', slug: 'studio-a' });
    await expect(
      service.create({ name: 'x', slug: 'studio-a' }),
    ).rejects.toThrow(ContractError);
    await expect(
      service.create({ name: 'x', slug: 'studio-a' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('能力标签超 5 个 → 400 校验拒绝', async () => {
    await expect(
      service.create({
        name: 'x',
        slug: 's',
        capabilityTags: ['1', '2', '3', '4', '5', '6'],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('更新展示页：案例超 6 个 → 400', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ id: 'w1' });
    await expect(
      service.updateShowcase('w1', { showcaseCases: [1, 2, 3, 4, 5, 6, 7] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('更新展示页：正常更新公告与状态', async () => {
    const ws = { id: 'w1', announcement: null, displayStatus: 'active' };
    mockRepo.findOne.mockResolvedValueOnce(ws);
    mockRepo.save.mockImplementation((v) => v);
    const updated = await service.updateShowcase('w1', {
      bio: '新的简介',
      announcement: '新公告',
      displayStatus: 'suspended',
    });
    expect(updated.bio).toBe('新的简介');
    expect(updated.announcement).toBe('新公告');
    expect(updated.displayStatus).toBe('suspended');
  });

  it('更新展示页：服务承诺写入', async () => {
    const ws = {
      id: 'w1',
      serviceCommitments: {},
    };
    mockRepo.findOne.mockResolvedValueOnce(ws);
    mockRepo.save.mockImplementation((v) => v);
    const updated = await service.updateShowcase('w1', {
      serviceCommitments: {
        response_time: '24h 响应',
        revisions: '2 次免费修订',
        refund: '14 天退款保障',
      },
    });
    expect(updated.serviceCommitments).toEqual({
      response_time: '24h 响应',
      revisions: '2 次免费修订',
      refund: '14 天退款保障',
    });
  });

  it('展示页查询：未找到 → 404', async () => {
    mockRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.updateShowcase('missing', { announcement: 'x' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('生命周期：created 事件按 §21.2 字段映射 upsert 新投影', async () => {
    mockRepo.findOne.mockResolvedValueOnce(null);
    mockRepo.create.mockImplementation((v) => v);
    mockRepo.save.mockImplementation((v) => v);
    const { duplicate, workspace } = await service.applyLifecycle(
      'evt-1',
      'workspace.created',
      {
        workspace_id: 'ws-c1',
        name: 'C 侧工作室',
        slug: 'c-studio',
        avatar_url: 'https://a/x.png',
        description: '全栈交付',
        capability_tags: ['web-dev'],
        service_commitments: { response_time: '2h' },
        budget_cny: 999,
      },
    );
    expect(duplicate).toBe(false);
    expect(workspace?.name).toBe('C 侧工作室');
    expect(workspace?.slug).toBe('c-studio');
    expect(workspace?.logoUrl).toBe('https://a/x.png');
    expect(workspace?.bio).toBe('全栈交付');
    expect(workspace?.capabilityTags).toEqual(['web-dev']);
    expect(workspace?.serviceCommitments).toEqual({ response_time: '2h' });
    // 白名单外字段（业务配置/预算）不落投影
    expect((workspace as unknown as Record<string, unknown>).budget_cny).toBeUndefined();
  });

  it('生命周期：deleted → displayStatus=frozen（停止展示与投递）', async () => {
    mockRepo.findOne.mockResolvedValueOnce({
      id: 'ws-c1',
      name: 'C 侧工作室',
      displayStatus: 'active',
    });
    mockRepo.save.mockImplementation((v) => v);
    const { workspace } = await service.applyLifecycle(
      'evt-2',
      'workspace.deleted',
      { workspace_id: 'ws-c1', deleted_at: '2026-09-04T08:00:00Z' },
    );
    expect(workspace?.displayStatus).toBe('frozen');
  });

  it('生命周期：重复 event_id → duplicate=true，不重复落库', async () => {
    dispatcherMock.recordInbound.mockResolvedValueOnce(false);
    mockRepo.findOne.mockResolvedValueOnce({ id: 'ws-c1', name: 'x' });
    const { duplicate } = await service.applyLifecycle(
      'evt-1',
      'workspace.updated',
      { workspace_id: 'ws-c1' },
    );
    expect(duplicate).toBe(true);
    expect(mockRepo.save).not.toHaveBeenCalled();
  });
});