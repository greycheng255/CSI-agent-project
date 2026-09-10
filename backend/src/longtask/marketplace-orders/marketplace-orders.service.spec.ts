import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MarketplaceOrdersService } from './marketplace-orders.service';
import { MarketplaceOrder } from './marketplace-order.entity';
import { MarketplaceCancelRequest } from './cancel-request.entity';
import { BalanceService } from '../../payment/balance.service';

describe('MarketplaceOrdersService（T12/T13：project_id 回填 + 对账）', () => {
  let service: MarketplaceOrdersService;

  const mockRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };
  const mockCancelRepo = { findOne: jest.fn() };
  const mockBalanceService = {
    payFromBalance: jest.fn(),
    addIncome: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketplaceOrdersService,
        { provide: getRepositoryToken(MarketplaceOrder), useValue: mockRepo },
        {
          provide: getRepositoryToken(MarketplaceCancelRequest),
          useValue: mockCancelRepo,
        },
        { provide: BalanceService, useValue: mockBalanceService },
      ],
    }).compile();
    service = module.get(MarketplaceOrdersService);
  });

  it('回填 project_id：null → 写入', async () => {
    const order = { id: 'o1', projectId: null };
    mockRepo.findOne.mockResolvedValueOnce(order);
    mockRepo.save.mockImplementation((v) => v);
    const saved = await service.applyProjectId(
      'o1',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(saved.projectId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('回填 project_id：同值重试幂等放行', async () => {
    mockRepo.findOne.mockResolvedValueOnce({
      id: 'o1',
      projectId: '11111111-1111-4111-8111-111111111111',
    });
    mockRepo.save.mockImplementation((v) => v);
    const saved = await service.applyProjectId(
      'o1',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(saved.projectId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('回填 project_id：已绑定不同值 → 409 CONFLICT_DUPLICATE', async () => {
    mockRepo.findOne.mockResolvedValueOnce({
      id: 'o1',
      projectId: '11111111-1111-4111-8111-111111111111',
    });
    await expect(
      service.applyProjectId('o1', '22222222-2222-4222-8222-222222222222'),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it('project_id 非 uuid → 400（避免 PG 22P02 500）', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ id: 'o1', projectId: null });
    await expect(service.applyProjectId('o1', 'p-1')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('project_id 为空 → 400', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ id: 'o1', projectId: null });
    await expect(service.applyProjectId('o1', '')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('order 不存在 → 404', async () => {
    mockRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.applyProjectId('x', 'p-1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('对账 #37：返回订单状态视图（无取消请求 → cancel_request 为 null）', async () => {
    mockRepo.findOne.mockResolvedValueOnce({
      id: 'o1',
      projectId: 'p-1',
      contractStatus: 'signed',
      deliveryStatus: 'in_accept',
      settlementStatus: null,
    });
    mockCancelRepo.findOne.mockResolvedValueOnce(null);
    const status = await service.orderStatus('o1');
    expect(status).toEqual({
      order_id: 'o1',
      project_id: 'p-1',
      contract_status: 'signed',
      delivery_status: 'in_accept',
      settlement_status: null,
      payment_status: 'unpaid',
      cancel_request: null,
    });
  });

  it('对账 #37：存在取消请求时返回 cancel_request 扩展对象（Console 对账兜底键）', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ id: 'o1' });
    mockCancelRepo.findOne.mockResolvedValueOnce({
      id: 'cr-1',
      cancelProposalSeq: 2,
      status: 'open',
      trigger: 'employer_request',
      ownerResponse: null,
      resolution: null,
      createdAt: new Date('2026-09-06T00:00:00Z'),
    });
    const status = await service.orderStatus('o1');
    expect(status.cancel_request).toEqual({
      cancel_request_id: 'cr-1',
      cancel_proposal_seq: 2,
      status: 'open',
      trigger: 'employer_request',
      owner_response: null,
      resolution: null,
      created_at: new Date('2026-09-06T00:00:00Z'),
    });
  });

  it('对账 #38：按 workspace 列出订单', async () => {
    mockRepo.find.mockResolvedValueOnce([{ id: 'o1' }]);
    const orders = await service.listByWorkspace('ws-1');
    expect(orders).toHaveLength(1);
    expect(mockRepo.find).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1' },
    });
  });
});