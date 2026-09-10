import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkspacesService } from './workspaces.service';
import { Workspace } from './workspace.entity';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
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
          provide: getRepositoryToken(MarketplaceOrder),
          useValue: { count: jest.fn().mockResolvedValue(0) },
        },
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

  it('更新展示页：写入经营类目（categoryIds，投递匹配依据）', async () => {
    const ws = { id: 'w1', categoryIds: null };
    mockRepo.findOne.mockResolvedValueOnce(ws);
    mockRepo.save.mockImplementation((v) => v);
    const updated = await service.updateShowcase('w1', {
      categoryIds: ['web'],
      receivePlatformPush: true,
    });
    expect(updated.categoryIds).toEqual(['web']);
  });

  it('更新展示页：引导配置写入名称与 logo（PRD §4.1）', async () => {
    const ws = { id: 'w1', name: '旧名', logoUrl: null };
    mockRepo.findOne.mockResolvedValueOnce(ws);
    mockRepo.save.mockImplementation((v) => v);
    const updated = await service.updateShowcase('w1', {
      name: '  新工作室  ',
      logoUrl: 'https://cdn/logo.png',
    });
    expect(updated.name).toBe('新工作室');
    expect(updated.logoUrl).toBe('https://cdn/logo.png');
  });

  it('更新展示页：空名称不覆盖原值', async () => {
    const ws = { id: 'w1', name: '保留名' };
    mockRepo.findOne.mockResolvedValueOnce(ws);
    mockRepo.save.mockImplementation((v) => v);
    const updated = await service.updateShowcase('w1', { name: '   ' });
    expect(updated.name).toBe('保留名');
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

  describe('ensureDefaultForOwner（PRD §4.1/§4.2 默认工作室自动开通）', () => {
    it('无工作室 → 自动创建默认工作室并绑定 owner（默认值对齐）', async () => {
      mockRepo.findOne.mockResolvedValue(null); // owner 查询 + slug 冲突探测均无命中
      mockRepo.create.mockImplementation((v) => v);
      mockRepo.save.mockImplementation((v) => v);

      const { created, workspace } = await service.ensureDefaultForOwner({
        ownerUserId: '11111111-2222-3333-4444-555555555555',
        displayName: '星辰',
      });
      expect(created).toBe(true);
      expect(workspace.name).toBe('星辰 的 AI 工作室');
      expect(workspace.slug).toBe('ai-ws-11111111');
      expect(workspace.ownerUserId).toBe('11111111-2222-3333-4444-555555555555');
      expect(workspace.displayStatus).toBe('active');
      expect(workspace.receivePlatformPush).toBe(true);
    });

    it('已有工作室 → 幂等返回 existing，不重复创建', async () => {
      const existing = { id: 'w1', name: '已有工作室', ownerUserId: 'u1' };
      mockRepo.findOne.mockResolvedValueOnce(existing);
      const { created, workspace } = await service.ensureDefaultForOwner({
        ownerUserId: 'u1',
        displayName: '甲',
      });
      expect(created).toBe(false);
      expect(workspace).toBe(existing);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('默认 slug 冲突 → 自动追加序号', async () => {
      mockRepo.findOne
        .mockResolvedValueOnce(null) // owner 无
        .mockResolvedValueOnce({ id: 'occupy', slug: 'ai-ws-11111111' }) // slug 被占
        .mockResolvedValueOnce(null); // -2 可用
      mockRepo.create.mockImplementation((v) => v);
      mockRepo.save.mockImplementation((v) => v);
      const { workspace } = await service.ensureDefaultForOwner({
        ownerUserId: '11111111-2222-3333-4444-555555555555',
        displayName: '乙',
      });
      expect(workspace.slug).toBe('ai-ws-11111111-2');
    });

    it('displayName 为空/未提供 → 使用默认名「我的 AI 工作室」', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.create.mockImplementation((v) => v);
      mockRepo.save.mockImplementation((v) => v);
      const { created, workspace } = await service.ensureDefaultForOwner({
        ownerUserId: '22222222-2222-3333-4444-555555555555',
        displayName: '  ',
      });
      expect(created).toBe(true);
      expect(workspace.name).toBe('我的 AI 工作室');
      expect(workspace.slug).toBe('ai-ws-22222222');
    });
  });
});