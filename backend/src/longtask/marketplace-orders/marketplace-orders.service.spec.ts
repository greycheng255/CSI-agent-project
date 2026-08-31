import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MarketplaceOrdersService } from './marketplace-orders.service';
import { MarketplaceOrder } from './marketplace-order.entity';

describe('MarketplaceOrdersService（T12/T13：project_id 回填 + 对账）', () => {
  let service: MarketplaceOrdersService;

  const mockRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketplaceOrdersService,
        { provide: getRepositoryToken(MarketplaceOrder), useValue: mockRepo },
      ],
    }).compile();
    service = module.get(MarketplaceOrdersService);
  });

  it('回填 project_id：null → 写入', async () => {
    const order = { id: 'o1', projectId: null };
    mockRepo.findOne.mockResolvedValueOnce(order);
    mockRepo.save.mockImplementation((v) => v);
    const saved = await service.applyProjectId('o1', 'p-1');
    expect(saved.projectId).toBe('p-1');
  });

  it('回填 project_id：同值重试幂等放行', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ id: 'o1', projectId: 'p-1' });
    mockRepo.save.mockImplementation((v) => v);
    const saved = await service.applyProjectId('o1', 'p-1');
    expect(saved.projectId).toBe('p-1');
  });

  it('回填 project_id：已绑定不同值 → 409 CONFLICT_DUPLICATE', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ id: 'o1', projectId: 'p-1' });
    await expect(service.applyProjectId('o1', 'p-2')).rejects.toMatchObject({
      status: 409,
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

  it('对账 #37：返回订单状态视图', async () => {
    mockRepo.findOne.mockResolvedValueOnce({
      id: 'o1',
      projectId: 'p-1',
      contractStatus: 'signed',
      deliveryStatus: 'in_accept',
      settlementStatus: null,
    });
    const status = await service.orderStatus('o1');
    expect(status).toEqual({
      order_id: 'o1',
      project_id: 'p-1',
      contract_status: 'signed',
      delivery_status: 'in_accept',
      settlement_status: null,
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