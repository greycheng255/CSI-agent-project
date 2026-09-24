import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SpecContractService } from './spec-contract.service';
import { MarketplaceOrder } from './marketplace-order.entity';
import { EmployerMention } from './employer-mention.entity';
import { CancelSkeletonService } from './cancel-skeleton.service';
import { MarketplaceTasksService } from '../marketplace-tasks/marketplace-tasks.service';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';
import { TimeoutScannerService } from '../contract/timeout-scanner.service';
import { NotificationDeliveryService } from '../../wechat/notification-delivery.service';
import { computeSpecHash } from '../contract/spec-hash';

describe('SpecContractService（T15/T16：场景四 + 7 天重开）', () => {
  let service: SpecContractService;

  const MENTION_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3300';

  const mockOrdersRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };
  const mockMentionsRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn((v) => v),
  };
  const mockTasksService = {
    reopenBidding: jest.fn(),
    findById: jest.fn().mockResolvedValue({ employerUserId: 'emp-1' }),
  };
  const mockCancelService = { initiateCancel: jest.fn() };
  const mockDispatcher = { enqueue: jest.fn() };
  const mockTimeoutScanner = { register: jest.fn(), cancel: jest.fn() };
  const mockNotify = { notifyEmployerMention: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockMentionsRepo.create.mockImplementation((v) => v);
    mockMentionsRepo.save.mockImplementation((v) => v);
    mockTasksService.findById.mockResolvedValue({ employerUserId: 'emp-1' });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpecContractService,
        { provide: getRepositoryToken(MarketplaceOrder), useValue: mockOrdersRepo },
        { provide: getRepositoryToken(EmployerMention), useValue: mockMentionsRepo },
        { provide: MarketplaceTasksService, useValue: mockTasksService },
        { provide: CancelSkeletonService, useValue: mockCancelService },
        { provide: WebhookDispatcherService, useValue: mockDispatcher },
        { provide: TimeoutScannerService, useValue: mockTimeoutScanner },
        { provide: NotificationDeliveryService, useValue: mockNotify },
      ],
    }).compile();
    service = module.get(SpecContractService);
  });

  function order(overrides: Partial<MarketplaceOrder> = {}) {
    return {
      id: 'o1',
      workspaceId: 'ws-1',
      projectId: 'p1',
      marketplaceTaskId: 'task-1',
      specVersion: 0,
      contractStatus: 'signing',
      specRejectionCount: 0,
      specDeadline: null,
      specHash: null,
      specSnapshot: null,
      milestones: null,
      ...overrides,
    } as MarketplaceOrder;
  }

  it('employer-mentions：新 Mention → 落库收件箱 + 通知雇主（2026-09-02 Console 探测补校验）', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    mockMentionsRepo.findOne.mockResolvedValueOnce(null);

    const res = await service.receiveEmployerMention('o1', {
      mention_id: MENTION_ID,
      project_task_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      source_comment_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
      from: {
        type: 'agent',
        id: '3f2504e0-4f89-41d3-9a0c-0305e82c3303',
        display_name: 'Dev Agent',
      },
      content: { text: '@employer 是否需要支持微信 OAuth？', attachments: [] },
      sent_at: '2026-09-02T10:00:00Z',
    });

    expect(res).toMatchObject({ ok: true, mention_id: MENTION_ID, duplicate: false });
    expect(mockMentionsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionId: MENTION_ID,
        orderId: 'o1',
        sourceCommentId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
        fromType: 'agent',
        employerUserId: 'emp-1',
        status: 'pending',
      }),
    );
    expect(mockNotify.notifyEmployerMention).toHaveBeenCalledWith(
      'emp-1',
      expect.objectContaining({ orderId: 'o1', mentionId: MENTION_ID }),
    );
  });

  it('employer-mentions：重复 mention_id → 幂等，不重复落库/通知', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    mockMentionsRepo.findOne.mockResolvedValueOnce({
      id: 'row-1',
      mentionId: MENTION_ID,
      createdAt: new Date('2026-09-02T10:00:01Z'),
    });

    const res = await service.receiveEmployerMention('o1', {
      mention_id: MENTION_ID,
      content: { text: 'dup' },
    });

    expect(res).toMatchObject({ ok: true, mention_id: MENTION_ID, duplicate: true });
    expect(mockMentionsRepo.save).not.toHaveBeenCalled();
    expect(mockNotify.notifyEmployerMention).not.toHaveBeenCalled();
  });

  it('employer-mentions：缺 content.text → 400 VALIDATION_INVALID_PAYLOAD', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    await expect(
      service.receiveEmployerMention('o1', { mention_id: MENTION_ID }),
    ).rejects.toMatchObject({
      status: 400,
      errorCode: 'VALIDATION_INVALID_PAYLOAD',
    });
  });

  it('employer-mentions：from.id 非 uuid → 400（此前直落 uuid 列触发 PG 22P02 → 500）', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    await expect(
      service.receiveEmployerMention('o1', {
        mention_id: MENTION_ID,
        from: { type: 'agent', id: 'a1' },
        content: { text: 'x' },
      }),
    ).rejects.toMatchObject({
      status: 400,
      errorCode: 'VALIDATION_INVALID_PAYLOAD',
    });
    expect(mockMentionsRepo.save).not.toHaveBeenCalled();
  });

  it('employer-mentions：订单不存在 → 404 NOT_FOUND_ORDER（补归属校验缺口）', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.receiveEmployerMention('nope', {
        mention_id: MENTION_ID,
        content: { text: 'x' },
      }),
    ).rejects.toMatchObject({ status: 404, errorCode: 'NOT_FOUND_ORDER' });
  });

  it('submitSpec：校验权重和=100%、落快照、启动 7 天计时、注册超时', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    mockOrdersRepo.save.mockImplementation((v) => v);

    const saved = await service.submitSpec('o1', {
      specHash: 'hash-abc',
      milestones: [
        { key: 'm1', weight: 0.4, status: 'pending' },
        { key: 'm2', weight: 0.6, status: 'pending' },
      ],
    });
    expect(saved.contractStatus).toBe('awaiting_confirmation');
    expect(saved.specVersion).toBe(1);
    expect(saved.specHash).toBe('hash-abc'); // 只记录不重算
    const windowMs = saved.specDeadline!.getTime() - Date.now();
    expect(windowMs).toBeGreaterThan(7 * 24 * 60 * 60 * 1000 - 5000);
    expect(mockTimeoutScanner.register).toHaveBeenCalledWith(
      expect.stringContaining('spec_employer_confirm:o1'),
      expect.any(Number),
      { orderId: 'o1' },
    );
  });

  it('submitSpec：未传 spec_hash → 平台默认口径补算（canonical JSON + SHA-256）', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    mockOrdersRepo.save.mockImplementation((v) => v);

    const saved = await service.submitSpec('o1', {
      specContent: { b: 1, a: 2 },
      milestones: [{ key: 'm1', weight: 1 }],
    });
    expect(saved.specHash).toBe(computeSpecHash({ b: 1, a: 2 }));
  });

  it('submitSpec：无里程碑 / 权重全零 → 422 VALIDATION_MILESTONE_WEIGHT_INVALID（§3.2.8 结算依据）', async () => {
    mockOrdersRepo.findOne.mockResolvedValue(order());
    await expect(service.submitSpec('o1', {})).rejects.toMatchObject({
      status: 422,
      errorCode: 'VALIDATION_MILESTONE_WEIGHT_INVALID',
    });
    await expect(
      service.submitSpec('o1', { milestones: [{ key: 'm1', weight: 0 }] }),
    ).rejects.toMatchObject({
      status: 422,
      errorCode: 'VALIDATION_MILESTONE_WEIGHT_INVALID',
    });
    expect(mockOrdersRepo.save).not.toHaveBeenCalled();
  });

  it('submitSpec：权重和≠100% → 400', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    await expect(
      service.submitSpec('o1', {
        milestones: [{ key: 'm1', weight: 0.4 }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('submitSpec：已提交过 → 409 CONFLICT_SPEC_VERSION', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order({ specVersion: 1 }));
    await expect(service.submitSpec('o1', {})).rejects.toMatchObject({
      status: 409,
    });
  });

  it('雇主确认：signed + 取消超时 + 投递 spec.confirmed', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(
      order({ contractStatus: 'awaiting_confirmation', specVersion: 1 }),
    );
    mockOrdersRepo.save.mockImplementation((v) => v);

    const saved = await service.employerAction('o1', 'confirmed');
    expect(saved.contractStatus).toBe('signed');
    expect(saved.specDeadline).toBeNull();
    expect(mockTimeoutScanner.cancel).toHaveBeenCalledWith(
      'spec_employer_confirm:o1',
    );
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'spec.confirmed',
      expect.stringContaining('/v1/webhooks/spec/employer-action'),
      expect.objectContaining({
        event_type: 'spec.confirmed',
        order_id: 'o1',
        project_id: 'p1',
      }),
    );
  });

  it('雇主驳回：计数 + 投递 spec.rejected；第 5 次触发协商取消', async () => {
    mockOrdersRepo.findOne.mockResolvedValue(
      order({ contractStatus: 'awaiting_confirmation', specVersion: 1, specRejectionCount: 4 }),
    );
    mockOrdersRepo.save.mockImplementation((v) => v);

    const saved = await service.employerAction('o1', 'rejected', '不认可范围');
    expect(saved.specRejectionCount).toBe(5);
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'spec.rejected',
      expect.any(String),
      expect.objectContaining({
        event_type: 'spec.rejected',
        reject_reason: '不认可范围',
        workspace_id: 'ws-1',
      }),
    );
    expect(mockCancelService.initiateCancel).toHaveBeenCalledWith(
      'o1',
      'spec_rejection_limit',
    );
  });

  it('雇主动作：非等待确认状态 → 422', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order({ contractStatus: 'signed' }));
    await expect(service.employerAction('o1', 'confirmed')).rejects.toMatchObject({
      status: 422,
    });
  });

  it('7 天超时：spec.timeout + 订单取消 + 任务重开', async () => {
    const expired = order({
      contractStatus: 'awaiting_confirmation',
      specVersion: 1,
      specDeadline: new Date('2026-08-20T00:00:00Z'),
    });
    mockOrdersRepo.find.mockResolvedValueOnce([expired]);
    mockOrdersRepo.save.mockImplementation((v) => v);

    const count = await service.scanSpecTimeouts(new Date('2026-08-27T00:00:00Z'));
    expect(count).toBe(1);
    expect(expired.contractStatus).toBe('cancelled');
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'spec.timeout',
      expect.stringContaining('/v1/webhooks/spec/employer-action'),
      expect.objectContaining({ event_type: 'spec.timeout', order_id: 'o1' }),
    );
    expect(mockTasksService.reopenBidding).toHaveBeenCalledWith('task-1');
  });

  it('雇主回复 Mention：落库 replied + 投递 §13.3 employer-reply 给 Console', async () => {
    mockMentionsRepo.findOne.mockResolvedValueOnce({
      id: 'row-1',
      mentionId: 'm-1',
      orderId: 'o1',
      projectId: 'p1',
      projectTaskId: 'pt-1',
      sourceCommentId: 'c-1',
      employerUserId: 'emp-1',
      status: 'pending',
    });

    const saved = await service.employerReplyMention('o1', 'row-1', {
      text: '需要支持微信和 Google 登录',
      fromId: 'emp-1',
      fromDisplayName: 'ABC 公司',
    });

    expect(saved.status).toBe('replied');
    expect(saved.repliedAt).toBeInstanceOf(Date);
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'task.employer_reply',
      expect.stringContaining('/v1/webhooks/task/employer-reply'),
      expect.objectContaining({
        mention_id: 'm-1',
        source_comment_id: 'c-1',
        project_task_id: 'pt-1',
        order_id: 'o1',
        in_reply_to_comment_id: 'c-1',
        content: expect.objectContaining({ text: '需要支持微信和 Google 登录' }),
        from: expect.objectContaining({ type: 'employer', display_name: 'ABC 公司' }),
      }),
    );
  });

  it('雇主回复 Mention：已回复过 → 422 STATE_INVALID_TRANSITION', async () => {
    mockMentionsRepo.findOne.mockResolvedValueOnce({
      id: 'row-1',
      mentionId: 'm-1',
      orderId: 'o1',
      status: 'replied',
    });
    await expect(
      service.employerReplyMention('o1', 'row-1', { text: 'again' }),
    ).rejects.toMatchObject({ status: 422, errorCode: 'STATE_INVALID_TRANSITION' });
    expect(mockDispatcher.enqueue).not.toHaveBeenCalled();
  });

  it('雇主回复 Mention：mention 不存在 → 404 NOT_FOUND_MENTION', async () => {
    mockMentionsRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.employerReplyMention('o1', 'nope', { text: 'x' }),
    ).rejects.toMatchObject({ status: 404, errorCode: 'NOT_FOUND_MENTION' });
  });
});