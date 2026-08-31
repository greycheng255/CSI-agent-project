import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SettlementsService } from './settlements.service';
import { MarketplaceSettlement } from './settlement.entity';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';

describe('SettlementsService（T20/T21：备数据 + 划款交关联方）', () => {
  let service: SettlementsService;

  const mockSettleRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn() };
  const mockOrdersRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };
  const mockDispatcher = { enqueue: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementsService,
        {
          provide: getRepositoryToken(MarketplaceSettlement),
          useValue: mockSettleRepo,
        },
        { provide: getRepositoryToken(MarketplaceOrder), useValue: mockOrdersRepo },
        { provide: WebhookDispatcherService, useValue: mockDispatcher },
      ],
    }).compile();
    service = module.get(SettlementsService);
  });

  it('触发结算：按 verified_passed 里程碑备结算数据（平台不划款）', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce({
      id: 'o1',
      workspaceId: 'ws-1',
      finalPriceCny: 10_000,
      milestones: [
        { key: 'm1', weight: 0.4, status: 'verified_passed' },
        { key: 'm2', weight: 0.6, status: 'pending' },
      ],
    });
    mockSettleRepo.findOne.mockResolvedValueOnce(null);
    mockSettleRepo.create.mockImplementation((v) => v);
    mockSettleRepo.save.mockImplementation((v) => ({ ...v, id: 's1' }));

    const settlement = await service.trigger('o1');
    expect(settlement.amountCny).toBe(4_000);
    expect(settlement.status).toBe('pending');
    // 划款动作只交给关联方：服务内无任何资金执行逻辑
  });

  it('权重和≠100% → 400；重复触发 → 409', async () => {
    mockOrdersRepo.findOne.mockResolvedValue({
      id: 'o1',
      workspaceId: 'ws-1',
      finalPriceCny: 100,
      milestones: [{ weight: 0.4 }],
    });
    mockSettleRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.trigger('o1')).rejects.toMatchObject({ status: 400 });

    mockOrdersRepo.findOne.mockResolvedValue({
      id: 'o1',
      workspaceId: 'ws-1',
      finalPriceCny: 100,
      milestones: [{ weight: 1, status: 'verified_passed' }],
    });
    mockSettleRepo.findOne.mockResolvedValueOnce({ id: 's1' });
    await expect(service.trigger('o1')).rejects.toMatchObject({ status: 409 });
  });

  it('消费 settlement.completed 回写 → settled + 订单状态同步', async () => {
    mockSettleRepo.findOne.mockResolvedValueOnce({ id: 's1', orderId: 'o1', status: 'pending' });
    mockSettleRepo.save.mockImplementation((v) => v);
    mockOrdersRepo.findOne.mockResolvedValueOnce({ id: 'o1', settlementStatus: null });
    mockOrdersRepo.save.mockImplementation((v) => v);

    await service.consumeSettlementCompleted('o1');
    const savedOrder = mockOrdersRepo.save.mock.calls[0][0] as MarketplaceOrder;
    expect(savedOrder.settlementStatus).toBe('settled');
  });

  it('对账 #35 视图 + #36 列表', async () => {
    mockSettleRepo.findOne.mockResolvedValueOnce({
      orderId: 'o1',
      status: 'settled',
      amountCny: 4_000,
      completedAt: new Date('2026-08-27T00:00:00Z'),
    });
    const view = await service.getByOrder('o1');
    expect(view.order_id).toBe('o1');
    expect(view.settlement_status).toBe('settled');

    mockSettleRepo.find.mockResolvedValueOnce([{ id: 's1' }]);
    const list = await service.listByWorkspace('ws-1');
    expect(list).toHaveLength(1);
  });

  it('申诉期关闭扫描：投递 appeal-period-closed', async () => {
    mockOrdersRepo.find.mockResolvedValueOnce([
      {
        id: 'o1',
        projectId: 'p1',
        afterSaleDeadline: new Date('2026-08-20T00:00:00Z'),
        settlementStatus: 'settled',
      },
    ]);
    mockSettleRepo.findOne.mockResolvedValueOnce({
      id: 's1',
      orderId: 'o1',
      status: 'settled',
    });
    mockSettleRepo.save.mockImplementation((v) => v);

    const closed = await service.scanAppealPeriodClosed(new Date('2026-08-27T00:00:00Z'));
    expect(closed).toBe(1);
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'settlement.appeal_period_closed',
      expect.stringContaining('/v1/webhooks/settlement/appeal-period-closed'),
      expect.objectContaining({ order_id: 'o1', project_id: 'p1' }),
    );
  });
});