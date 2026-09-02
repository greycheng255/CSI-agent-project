import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RevisionNegotiationService } from './revision-negotiation.service';
import { MarketplaceRevisionNegotiation } from './negotiation.entity';
import { MarketplaceOrder } from './marketplace-order.entity';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';

describe('RevisionNegotiationService（T18：2 天窗口 + 4 选项默认 C）', () => {
  let service: RevisionNegotiationService;

  const mockNegotiationRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn() };
  const mockOrdersRepo = { findOne: jest.fn(), save: jest.fn() };
  const mockDispatcher = { enqueue: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RevisionNegotiationService,
        {
          provide: getRepositoryToken(MarketplaceRevisionNegotiation),
          useValue: mockNegotiationRepo,
        },
        { provide: getRepositoryToken(MarketplaceOrder), useValue: mockOrdersRepo },
        { provide: WebhookDispatcherService, useValue: mockDispatcher },
      ],
    }).compile();
    service = module.get(RevisionNegotiationService);
  });

  it('启动 2 天协商窗口并投递 started 事件', async () => {
    mockNegotiationRepo.create.mockImplementation((v) => v);
    mockNegotiationRepo.save.mockImplementation((v) => ({ ...v, id: 'n1' }));

    const saved = await service.start('o1', 'revision_exhausted');
    const windowMs = saved.deadline!.getTime() - Date.now();
    expect(windowMs).toBeGreaterThan(2 * 24 * 60 * 60 * 1000 - 5000);
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'revision.negotiation_action',
      expect.stringContaining('/v1/webhooks/revision/negotiation-action'),
      expect.objectContaining({ action: 'started', order_id: 'o1' }),
    );
  });

  it('决策 C（接受当前）：订单 accepted + 售后申诉期', async () => {
    mockNegotiationRepo.findOne.mockResolvedValueOnce({
      id: 'n1',
      orderId: 'o1',
      status: 'open',
    });
    mockNegotiationRepo.save.mockImplementation((v) => v);
    mockOrdersRepo.findOne.mockResolvedValueOnce({
      id: 'o1',
      deliveryStatus: 'revising',
      afterSaleDeadline: null,
    });
    mockOrdersRepo.save.mockImplementation((v) => v);

    const saved = await service.decide('o1', 'n1', 'C');
    expect(saved.decision).toBe('C');
    const savedOrder = mockOrdersRepo.save.mock.calls[0][0] as MarketplaceOrder;
    expect(savedOrder.deliveryStatus).toBe('accepted');
    expect(savedOrder.afterSaleDeadline).not.toBeNull();
  });

  it('决策 A/B/D：记录决策，不触发接受动作', async () => {
    mockNegotiationRepo.findOne.mockImplementation(() => ({
      id: 'n1',
      orderId: 'o1',
      status: 'open',
    }));
    mockNegotiationRepo.save.mockImplementation((v) => v);

    await service.decide('o1', 'n1', 'A');
    expect(mockOrdersRepo.save).not.toHaveBeenCalled();
    await service.decide('o1', 'n1', 'D');
  });

  it('已决窗口再决策 → 422', async () => {
    mockNegotiationRepo.findOne.mockResolvedValueOnce({
      id: 'n1',
      orderId: 'o1',
      status: 'resolved',
    });
    await expect(service.decide('o1', 'n1', 'C')).rejects.toMatchObject({
      status: 422,
    });
  });

  it('协商不属于该订单 → 404（归属校验）', async () => {
    mockNegotiationRepo.findOne.mockResolvedValueOnce({
      id: 'n1',
      orderId: 'other',
      status: 'open',
    });
    await expect(service.decide('o1', 'n1', 'C')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('2 天超时 → 默认 C + expired_default_c 事件 + 售后申诉期', async () => {
    const negotiation = {
      id: 'n1',
      orderId: 'o1',
      status: 'open',
      deadline: new Date('2026-08-20T00:00:00Z'),
    };
    mockNegotiationRepo.find.mockResolvedValueOnce([negotiation]);
    mockNegotiationRepo.save.mockImplementation((v) => v);
    mockOrdersRepo.findOne.mockResolvedValueOnce({
      id: 'o1',
      deliveryStatus: 'revising',
      afterSaleDeadline: null,
    });
    mockOrdersRepo.save.mockImplementation((v) => v);

    const count = await service.scanNegotiationTimeouts(
      new Date('2026-08-22T00:00:00Z'),
    );
    expect(count).toBe(1);
    expect(negotiation.decision).toBe('C');
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'revision.negotiation_action',
      expect.any(String),
      expect.objectContaining({ action: 'expired_default_c', decision: 'C' }),
    );
    const savedOrder = mockOrdersRepo.save.mock.calls[0][0] as MarketplaceOrder;
    expect(savedOrder.deliveryStatus).toBe('accepted');
  });
});