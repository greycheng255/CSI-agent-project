import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SpecContractService } from './spec-contract.service';
import { MarketplaceOrder } from './marketplace-order.entity';
import { EmployerMention } from './employer-mention.entity';
import { EmployerOutboundMessage } from './employer-outbound-message.entity';
import { CancelSkeletonService } from './cancel-skeleton.service';
import { MarketplaceTasksService } from '../marketplace-tasks/marketplace-tasks.service';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';
import { TimeoutScannerService } from '../contract/timeout-scanner.service';
import { NotificationDeliveryService } from '../../wechat/notification-delivery.service';
import { computeSpecHash } from '../contract/spec-hash';

describe('SpecContractService（T15/T16：场景四 + 7 天重开）', () => {
  let service: SpecContractService;

  const MENTION_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3300';

  const mockOrdersRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };
  const mockMentionsRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((v: Partial<EmployerMention>) => v),
    save: jest.fn((v: Partial<EmployerMention>) => v),
  };
  const mockOutboundRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((v: Partial<EmployerOutboundMessage>) => v),
    save: jest.fn((v: Partial<EmployerOutboundMessage>) => v),
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
    mockMentionsRepo.create.mockImplementation(
      (v: Partial<EmployerMention>) => v,
    );
    mockMentionsRepo.save.mockImplementation(
      (v: Partial<EmployerMention>) => v,
    );
    mockOutboundRepo.create.mockImplementation(
      (v: Partial<EmployerOutboundMessage>) => v,
    );
    mockOutboundRepo.save.mockImplementation(
      (v: Partial<EmployerOutboundMessage>) => ({ id: 'msg-1', ...v }),
    );
    mockMentionsRepo.find.mockResolvedValue([]);
    mockOutboundRepo.find.mockResolvedValue([]);
    mockTasksService.findById.mockResolvedValue({ employerUserId: 'emp-1' });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpecContractService,
        {
          provide: getRepositoryToken(MarketplaceOrder),
          useValue: mockOrdersRepo,
        },
        {
          provide: getRepositoryToken(EmployerMention),
          useValue: mockMentionsRepo,
        },
        {
          provide: getRepositoryToken(EmployerOutboundMessage),
          useValue: mockOutboundRepo,
        },
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

    expect(res).toMatchObject({
      ok: true,
      mention_id: MENTION_ID,
      duplicate: false,
    });
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
      orderId: 'o1',
      content: { text: 'dup', attachments: [] },
      createdAt: new Date('2026-09-02T10:00:01Z'),
    });

    const res = await service.receiveEmployerMention('o1', {
      mention_id: MENTION_ID,
      content: { text: 'dup' },
    });

    expect(res).toMatchObject({
      ok: true,
      mention_id: MENTION_ID,
      duplicate: true,
    });
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

  it('employer-mentions：订单已 signed（非签约阶段）→ 422 STATE_PROJECT_NOT_SPEC_SIGNING（§13.2）', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(
      order({ contractStatus: 'signed' }),
    );
    mockMentionsRepo.findOne.mockResolvedValueOnce(null);

    await expect(
      service.receiveEmployerMention('o1', {
        mention_id: MENTION_ID,
        content: { text: '@employer 交付期问题' },
      }),
    ).rejects.toMatchObject({
      status: 422,
      errorCode: 'STATE_PROJECT_NOT_SPEC_SIGNING',
    });
    expect(mockMentionsRepo.save).not.toHaveBeenCalled();
    expect(mockNotify.notifyEmployerMention).not.toHaveBeenCalled();
  });

  it('employer-mentions：订单已 cancelled → 422 STATE_PROJECT_NOT_SPEC_SIGNING', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(
      order({ contractStatus: 'cancelled' }),
    );
    mockMentionsRepo.findOne.mockResolvedValueOnce(null);

    await expect(
      service.receiveEmployerMention('o1', {
        mention_id: MENTION_ID,
        content: { text: 'x' },
      }),
    ).rejects.toMatchObject({
      status: 422,
      errorCode: 'STATE_PROJECT_NOT_SPEC_SIGNING',
    });
  });

  it('employer-mentions：awaiting_confirmation（待雇主确认 Spec）属签约阶段 → 受理', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(
      order({ contractStatus: 'awaiting_confirmation' }),
    );
    mockMentionsRepo.findOne.mockResolvedValueOnce(null);

    const res = await service.receiveEmployerMention('o1', {
      mention_id: MENTION_ID,
      content: { text: '@employer 请确认 Spec' },
    });

    expect(res).toMatchObject({
      ok: true,
      mention_id: MENTION_ID,
      duplicate: false,
    });
    expect(mockMentionsRepo.save).toHaveBeenCalled();
  });

  it('employer-mentions：已受理的 mention_id 重试 + 订单已 signed → 仍幂等返回 duplicate（不变 422）', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(
      order({ contractStatus: 'signed' }),
    );
    mockMentionsRepo.findOne.mockResolvedValueOnce({
      id: 'row-1',
      mentionId: MENTION_ID,
      orderId: 'o1',
      content: { text: 'late retry', attachments: [] },
      createdAt: new Date('2026-09-02T10:00:01Z'),
    });

    const res = await service.receiveEmployerMention('o1', {
      mention_id: MENTION_ID,
      content: { text: 'late retry' },
    });

    expect(res).toMatchObject({
      ok: true,
      mention_id: MENTION_ID,
      duplicate: true,
    });
    expect(mockMentionsRepo.save).not.toHaveBeenCalled();
  });

  it('employer-mentions：同 mention_id 但 content.text 不同 → 409 VALIDATION_IDEMPOTENCY_CONFLICT（§22.3）', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    mockMentionsRepo.findOne.mockResolvedValueOnce({
      id: 'row-1',
      mentionId: MENTION_ID,
      orderId: 'o1',
      content: { text: '原始提问', attachments: [] },
      createdAt: new Date('2026-09-02T10:00:01Z'),
    });

    await expect(
      service.receiveEmployerMention('o1', {
        mention_id: MENTION_ID,
        content: { text: '修正后的提问' },
      }),
    ).rejects.toMatchObject({
      status: 409,
      errorCode: 'VALIDATION_IDEMPOTENCY_CONFLICT',
    });
    expect(mockMentionsRepo.save).not.toHaveBeenCalled();
    expect(mockNotify.notifyEmployerMention).not.toHaveBeenCalled();
  });

  it('employer-mentions：同 mention_id 但订单不同 → 409', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    mockMentionsRepo.findOne.mockResolvedValueOnce({
      id: 'row-1',
      mentionId: MENTION_ID,
      orderId: 'other-order',
      content: { text: 'x', attachments: [] },
      createdAt: new Date('2026-09-02T10:00:01Z'),
    });

    await expect(
      service.receiveEmployerMention('o1', {
        mention_id: MENTION_ID,
        content: { text: 'x' },
      }),
    ).rejects.toMatchObject({
      status: 409,
      errorCode: 'VALIDATION_IDEMPOTENCY_CONFLICT',
    });
  });

  it('employer-mentions：同 mention_id、同正文，仅 sent_at/attachments 不同 → 仍幂等（不得误判为冲突）', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    mockMentionsRepo.findOne.mockResolvedValueOnce({
      id: 'row-1',
      mentionId: MENTION_ID,
      orderId: 'o1',
      content: { text: '同一条提问', attachments: [] },
      sentAt: new Date('2026-09-02T10:00:00Z'),
      createdAt: new Date('2026-09-02T10:00:01Z'),
    });

    const res = await service.receiveEmployerMention('o1', {
      mention_id: MENTION_ID,
      sent_at: '2026-09-02T11:30:00.000Z',
      content: {
        text: '  同一条提问  ',
        attachments: [{ name: 'a.png' }],
      },
    });

    expect(res).toMatchObject({ ok: true, duplicate: true });
    expect(mockMentionsRepo.save).not.toHaveBeenCalled();
  });

  it('employer-mentions：并发唯一约束冲突回读时 payload 不同 → 409（不静默吞掉）', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    mockMentionsRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'row-concurrent',
      mentionId: MENTION_ID,
      orderId: 'o1',
      content: { text: '并发的另一份内容', attachments: [] },
      createdAt: new Date('2026-09-02T10:00:01Z'),
    });
    mockMentionsRepo.save.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: '23505' }),
    );

    await expect(
      service.receiveEmployerMention('o1', {
        mention_id: MENTION_ID,
        content: { text: '本请求的内容' },
      }),
    ).rejects.toMatchObject({
      status: 409,
      errorCode: 'VALIDATION_IDEMPOTENCY_CONFLICT',
    });
  });

  it('submitSpec：校验权重和=100%、落快照、启动 7 天计时、注册超时', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    mockOrdersRepo.save.mockImplementation((v: MarketplaceOrder) => v);

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
    mockOrdersRepo.save.mockImplementation((v: MarketplaceOrder) => v);

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
    mockOrdersRepo.save.mockImplementation((v: MarketplaceOrder) => v);

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
      order({
        contractStatus: 'awaiting_confirmation',
        specVersion: 1,
        specRejectionCount: 4,
      }),
    );
    mockOrdersRepo.save.mockImplementation((v: MarketplaceOrder) => v);

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
    mockOrdersRepo.findOne.mockResolvedValueOnce(
      order({ contractStatus: 'signed' }),
    );
    await expect(
      service.employerAction('o1', 'confirmed'),
    ).rejects.toMatchObject({
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
    mockOrdersRepo.save.mockImplementation((v: MarketplaceOrder) => v);

    const count = await service.scanSpecTimeouts(
      new Date('2026-08-27T00:00:00Z'),
    );
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- objectContaining 返回 any，仅作断言匹配器
        content: expect.objectContaining({
          text: '需要支持微信和 Google 登录',
        }),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- 同上
        from: expect.objectContaining({
          type: 'employer',
          display_name: 'ABC 公司',
        }),
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
    ).rejects.toMatchObject({
      status: 422,
      errorCode: 'STATE_INVALID_TRANSITION',
    });
    expect(mockDispatcher.enqueue).not.toHaveBeenCalled();
  });

  it('雇主回复 Mention：mention 不存在 → 404 NOT_FOUND_MENTION', async () => {
    mockMentionsRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.employerReplyMention('o1', 'nope', { text: 'x' }),
    ).rejects.toMatchObject({ status: 404, errorCode: 'NOT_FOUND_MENTION' });
  });

  it('雇主主动发起消息：落库 queued + 投递 employer-reply（mention/thread 三字段为 null，eventId=行 id）', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    mockOutboundRepo.findOne.mockResolvedValueOnce(null);
    mockMentionsRepo.findOne.mockResolvedValueOnce({
      id: 'row-1',
      projectTaskId: 'pt-1',
    });

    const res = await service.sendEmployerMessage('o1', {
      text: '请补充一下数据导出的格式',
      fromId: 'emp-1',
      fromDisplayName: '用户24565',
    });

    expect(res.duplicate).toBe(false);
    expect(mockOutboundRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'o1',
        projectId: 'p1',
        projectTaskId: 'pt-1',
        employerUserId: 'emp-1',
        fromType: 'employer',
        addressees: [{ type: 'agent_owner' }],
        status: 'queued',
      }),
    );
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'task.employer_reply',
      expect.stringContaining('/v1/webhooks/task/employer-reply'),
      expect.objectContaining({
        // null = Console 新开顶层 Comment，不挂旧评论
        mention_id: null,
        source_comment_id: null,
        in_reply_to_comment_id: null,
        project_id: 'p1',
        project_task_id: 'pt-1',
        // Console 顶层 Comment 契约：task_id / 字符串 content / marketplace_comment_id
        task_id: 'pt-1',
        marketplace_comment_id: 'msg-1',
        order_id: 'o1',
        workspace_id: 'ws-1',
        marketplace_task_id: 'task-1',
        initiated_by: 'employer',
        addressees: [{ type: 'agent_owner' }],
        content: '请补充一下数据导出的格式',
      }),
      'msg-1',
    );
  });

  it('雇主主动发起消息：订单无 Console task_id → 422 不发（避免 Console 400 进死信）', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    mockOutboundRepo.findOne.mockResolvedValueOnce(null);
    mockMentionsRepo.findOne.mockResolvedValueOnce(null);

    await expect(
      service.sendEmployerMessage('o1', { text: '尚无入站提问时不可开新线程' }),
    ).rejects.toMatchObject({
      status: 422,
      errorCode: 'STATE_INVALID_TRANSITION',
    });
    expect(mockOutboundRepo.save).not.toHaveBeenCalled();
    expect(mockDispatcher.enqueue).not.toHaveBeenCalled();
  });

  it('雇主主动发起消息：同 client_message_id 幂等，不新增、不重复投递', async () => {
    const CLIENT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3309';
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    mockOutboundRepo.findOne.mockResolvedValueOnce({
      id: 'msg-1',
      orderId: 'o1',
      clientMessageId: CLIENT_ID,
    });

    const res = await service.sendEmployerMessage('o1', {
      text: '重复提交',
      clientMessageId: CLIENT_ID,
    });

    expect(res.duplicate).toBe(true);
    expect(mockOutboundRepo.save).not.toHaveBeenCalled();
    expect(mockDispatcher.enqueue).not.toHaveBeenCalled();
  });

  it('雇主主动发起消息：空 text → 400；client_message_id 非 uuid → 400', async () => {
    mockOrdersRepo.findOne.mockResolvedValue(order());
    await expect(
      service.sendEmployerMessage('o1', { text: '   ' }),
    ).rejects.toMatchObject({
      status: 400,
      errorCode: 'VALIDATION_INVALID_PAYLOAD',
    });
    await expect(
      service.sendEmployerMessage('o1', {
        text: 'hi',
        clientMessageId: 'not-a-uuid',
      }),
    ).rejects.toMatchObject({
      status: 400,
      errorCode: 'VALIDATION_INVALID_PAYLOAD',
    });
    expect(mockDispatcher.enqueue).not.toHaveBeenCalled();
  });

  it('雇主主动发起消息：订单无 project_id → 422 且不投递（避免 Console 400 死信）', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order({ projectId: null }));

    await expect(
      service.sendEmployerMessage('o1', { text: 'hello' }),
    ).rejects.toMatchObject({
      status: 422,
      errorCode: 'STATE_INVALID_TRANSITION',
    });
    expect(mockOutboundRepo.save).not.toHaveBeenCalled();
    expect(mockDispatcher.enqueue).not.toHaveBeenCalled();
  });

  it('雇主主动发起消息：订单已取消 → 422', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(
      order({ contractStatus: 'cancelled' }),
    );

    await expect(
      service.sendEmployerMessage('o1', { text: 'hello' }),
    ).rejects.toMatchObject({
      status: 422,
      errorCode: 'STATE_INVALID_TRANSITION',
    });
    expect(mockDispatcher.enqueue).not.toHaveBeenCalled();
  });

  it('沟通时间线：入站提问 + 回复展开 + 主动发起按时间升序合并', async () => {
    mockMentionsRepo.find.mockResolvedValueOnce([
      {
        id: 'm-row-1',
        fromType: 'agent',
        fromId: 'agent-1',
        fromDisplayName: 'Dev Agent',
        content: { text: '是否需要支持微信登录？', attachments: [] },
        status: 'replied',
        reply: {
          text: '需要支持微信和 Google 登录',
          attachments: [],
          from: { type: 'employer', id: 'emp-1', display_name: '用户24565' },
        },
        repliedAt: new Date('2026-09-02T10:05:00Z'),
        createdAt: new Date('2026-09-02T10:00:00Z'),
      },
    ]);
    mockOutboundRepo.find.mockResolvedValueOnce([
      {
        id: 'msg-1',
        fromType: 'employer',
        employerUserId: 'emp-1',
        fromDisplayName: '用户24565',
        content: { text: '请补充导出格式', attachments: [] },
        status: 'queued',
        createdAt: new Date('2026-09-02T10:10:00Z'),
      },
    ]);

    const items = await service.listEmployerThread('o1');

    expect(items.map((i) => i.kind)).toEqual(['question', 'reply', 'message']);
    expect(items.map((i) => i.direction)).toEqual([
      'inbound',
      'outbound',
      'outbound',
    ]);
    expect(items[1]).toMatchObject({
      id: 'm-row-1:reply',
      text: '需要支持微信和 Google 登录',
      from: { type: 'employer', displayName: '用户24565' },
    });
    expect(items[2]).toMatchObject({ id: 'msg-1', text: '请补充导出格式' });
  });

  it('沟通时间线：未回复的提问不展开回复项', async () => {
    mockMentionsRepo.find.mockResolvedValueOnce([
      {
        id: 'm-row-2',
        fromType: 'agent_owner',
        fromId: null,
        fromDisplayName: '张三',
        content: { text: '@employer 这一版怎么样', attachments: [] },
        status: 'pending',
        reply: null,
        repliedAt: null,
        createdAt: new Date('2026-09-02T11:00:00Z'),
      },
    ]);
    mockOutboundRepo.find.mockResolvedValueOnce([]);

    const items = await service.listEmployerThread('o1');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'question', status: 'pending' });
  });
});
