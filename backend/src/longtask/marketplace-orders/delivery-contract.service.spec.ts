import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeliveryContractService } from './delivery-contract.service';
import { MarketplaceDelivery } from './delivery.entity';
import { MarketplaceOrder } from './marketplace-order.entity';
import { RevisionNegotiationService } from './revision-negotiation.service';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';

describe('DeliveryContractService（T17：deliverables + 14 天自动验收）', () => {
  let service: DeliveryContractService;

  const mockDeliveryRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn() };
  const mockOrdersRepo = { findOne: jest.fn(), save: jest.fn() };
  const mockNegotiation = { start: jest.fn() };
  const mockDispatcher = { enqueue: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryContractService,
        { provide: getRepositoryToken(MarketplaceDelivery), useValue: mockDeliveryRepo },
        { provide: getRepositoryToken(MarketplaceOrder), useValue: mockOrdersRepo },
        { provide: RevisionNegotiationService, useValue: mockNegotiation },
        { provide: WebhookDispatcherService, useValue: mockDispatcher },
      ],
    }).compile();
    service = module.get(DeliveryContractService);
  });

  const order = () =>
    ({ id: 'o1', projectId: 'p1', deliveryStatus: null, afterSaleDeadline: null, specVersion: 1 }) as
      MarketplaceOrder;

  it('提交交付物：落记录 + 14 天计时 + 订单 in_accept', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    mockDeliveryRepo.findOne.mockResolvedValueOnce(null); // 无重复 seq
    mockDeliveryRepo.create.mockImplementation((v) => v);
    mockDeliveryRepo.save.mockImplementation((v) => v);

    const saved = await service.submitDeliverable('o1', {
      metadata: { summary: '交付报告' },
      submissionSeq: 1,
    });
    const windowMs = saved.acceptDeadline!.getTime() - saved.submittedAt!.getTime();
    expect(windowMs).toBe(14 * 24 * 60 * 60 * 1000);
    expect(mockOrdersRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryStatus: 'in_accept' }),
    );
  });

  it('重复 submission_seq → 409', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    mockDeliveryRepo.findOne.mockResolvedValueOnce({ id: 'd1' });
    await expect(
      service.submitDeliverable('o1', { submissionSeq: 1 }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('雇主验收通过：delivery.accepted + 7 天售后申诉期', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(order());
    mockDeliveryRepo.findOne.mockResolvedValueOnce({
      id: 'd1',
      orderId: 'o1',
      submissionSeq: 1,
      status: 'submitted',
    });
    mockDeliveryRepo.save.mockImplementation((v) => v);

    await service.employerReview('o1', 'accepted');
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'delivery.accepted',
      expect.stringContaining('/v1/webhooks/delivery/employer-review'),
      expect.objectContaining({ event_type: 'delivery.accepted', order_id: 'o1' }),
    );
    const savedOrder = mockOrdersRepo.save.mock.calls.pop()[0] as MarketplaceOrder;
    expect(savedOrder.deliveryStatus).toBe('accepted');
    expect(savedOrder.afterSaleDeadline).not.toBeNull();
  });

  it('要求修订超限（seq>=2）→ 自动进入 2 天协商窗口', async () => {
    mockOrdersRepo.findOne.mockResolvedValue(order());
    mockDeliveryRepo.findOne.mockResolvedValueOnce({
      id: 'd2',
      orderId: 'o1',
      submissionSeq: 3,
      status: 'submitted',
    });
    mockDeliveryRepo.save.mockImplementation((v) => v);

    await service.employerReview('o1', 'revision_requested', '不符合验收标准');
    expect(mockNegotiation.start).toHaveBeenCalledWith('o1', 'revision_exhausted');
  });

  it('14 天到期：auto_accepted + 售后申诉期', async () => {
    const delivery = {
      id: 'd1',
      orderId: 'o1',
      submissionSeq: 1,
      status: 'submitted',
      acceptDeadline: new Date('2026-08-20T00:00:00Z'),
    };
    mockDeliveryRepo.find.mockResolvedValueOnce([delivery]);
    mockDeliveryRepo.save.mockImplementation((v) => v);
    mockOrdersRepo.findOne.mockResolvedValue(order());

    const count = await service.scanAutoAccept(new Date('2026-09-03T00:00:00Z'));
    expect(count).toBe(1);
    expect(delivery.status).toBe('auto_accepted');
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'delivery.auto_accepted',
      expect.any(String),
      expect.objectContaining({ event_type: 'delivery.auto_accepted' }),
    );
  });

  it('催办计算委托纯函数', () => {
    const delivery = {
      submittedAt: new Date('2026-08-01T00:00:00Z'),
    } as MarketplaceDelivery;
    // 第 6 天 → 第 5 天催办已错过窗口不再返回
    expect(
      service.dueReminders(delivery, Date.parse('2026-08-07T00:00:00Z')),
    ).toEqual([]);
    expect(
      service.dueReminders(delivery, Date.parse('2026-08-06T12:00:00Z')),
    ).toEqual([5]);
  });

  it('order 不存在 → 404', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.submitDeliverable('x', {})).rejects.toMatchObject({
      status: 404,
    });
  });
});