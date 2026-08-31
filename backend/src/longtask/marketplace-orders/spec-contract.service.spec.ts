import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SpecContractService } from './spec-contract.service';
import { MarketplaceOrder } from './marketplace-order.entity';
import { CancelSkeletonService } from './cancel-skeleton.service';
import { MarketplaceTasksService } from '../marketplace-tasks/marketplace-tasks.service';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';
import { TimeoutScannerService } from '../contract/timeout-scanner.service';

describe('SpecContractService（T15/T16：场景四 + 7 天重开）', () => {
  let service: SpecContractService;

  const mockOrdersRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };
  const mockTasksService = { reopenBidding: jest.fn() };
  const mockCancelService = { initiateCancel: jest.fn() };
  const mockDispatcher = { enqueue: jest.fn() };
  const mockTimeoutScanner = { register: jest.fn(), cancel: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpecContractService,
        { provide: getRepositoryToken(MarketplaceOrder), useValue: mockOrdersRepo },
        { provide: MarketplaceTasksService, useValue: mockTasksService },
        { provide: CancelSkeletonService, useValue: mockCancelService },
        { provide: WebhookDispatcherService, useValue: mockDispatcher },
        { provide: TimeoutScannerService, useValue: mockTimeoutScanner },
      ],
    }).compile();
    service = module.get(SpecContractService);
  });

  function order(overrides: Partial<MarketplaceOrder> = {}) {
    return {
      id: 'o1',
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
      expect.objectContaining({ event_type: 'spec.rejected', rejection_count: 5 }),
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

  it('雇主回复：投递 employer_reply 给 Console', async () => {
    await service.notifyEmployerReply('o1', { body: '回复内容' });
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'task.employer_reply',
      expect.stringContaining('/v1/webhooks/task/employer-reply'),
      expect.objectContaining({ order_id: 'o1' }),
    );
  });
});