import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SpecChangeService } from './spec-change.service';
import { MarketplaceSpecChange } from './spec-change.entity';
import { MarketplaceOrder } from './marketplace-order.entity';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';

describe('SpecChangeService（T19：场景七 Spec 变更）', () => {
  let service: SpecChangeService;

  const mockChangeRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn() };
  const mockOrdersRepo = { findOne: jest.fn(), save: jest.fn() };
  const mockDispatcher = { enqueue: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpecChangeService,
        {
          provide: getRepositoryToken(MarketplaceSpecChange),
          useValue: mockChangeRepo,
        },
        { provide: getRepositoryToken(MarketplaceOrder), useValue: mockOrdersRepo },
        { provide: WebhookDispatcherService, useValue: mockDispatcher },
      ],
    }).compile();
    service = module.get(SpecChangeService);
  });

  it('雇主发起变更请求 → 投递 spec-change/request（启动 Console 24h 判定）', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce({ id: 'o1', projectId: 'p1' });
    mockChangeRepo.findOne.mockResolvedValueOnce(null);
    mockChangeRepo.create.mockImplementation((v) => v);
    mockChangeRepo.save.mockImplementation((v) => ({ ...v, id: 'c1' }));

    const saved = await service.employerRequestChange('o1', 1, { note: '加需求' });
    expect(saved.status).toBe('requested');
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'spec_change.request',
      expect.stringContaining('/v1/webhooks/spec-change/request'),
      expect.objectContaining({ order_id: 'o1', change_seq: 1 }),
    );
  });

  it('同 change_seq 重复发起 → 409', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce({ id: 'o1' });
    mockChangeRepo.findOne.mockResolvedValueOnce({ id: 'c1' });
    await expect(
      service.employerRequestChange('o1', 1, {}),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('Console 判定 new_requirement → 投递雇主二次确认', async () => {
    mockChangeRepo.findOne.mockResolvedValueOnce({
      id: 'c1',
      orderId: 'o1',
      status: 'requested',
    });
    mockChangeRepo.save.mockImplementation((v) => v);

    await service.classify('o1', 'c1', 'new_requirement');
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'spec_change.employer_confirmation',
      expect.stringContaining('/v1/webhooks/spec-change/employer-confirmation'),
      expect.objectContaining({ request_id: 'c1', order_id: 'o1' }),
    );
  });

  it('Console 判定 revision → 不触发二次确认', async () => {
    mockChangeRepo.findOne.mockResolvedValueOnce({
      id: 'c1',
      orderId: 'o1',
      status: 'requested',
    });
    mockChangeRepo.save.mockImplementation((v) => v);
    await service.classify('o1', 'c1', 'revision');
    expect(mockDispatcher.enqueue).not.toHaveBeenCalled();
  });

  it('变更提案 + 确认 → Spec version+1', async () => {
    mockOrdersRepo.findOne.mockResolvedValueOnce({ id: 'o1' });
    mockChangeRepo.findOne.mockResolvedValueOnce(null);
    mockChangeRepo.create.mockImplementation((v) => v);
    mockChangeRepo.save.mockImplementation((v) => ({ ...v, id: 'c1' }));

    await service.propose('o1', 1, { payload: 'x' });

    mockChangeRepo.findOne.mockResolvedValueOnce({
      id: 'c1',
      orderId: 'o1',
      status: 'proposed',
    });
    mockOrdersRepo.findOne.mockResolvedValueOnce({ id: 'o1', specVersion: 3 });
    mockOrdersRepo.save.mockImplementation((v) => v);

    await service.confirm('o1', 'c1');
    const savedOrder = mockOrdersRepo.save.mock.calls[0][0] as MarketplaceOrder;
    expect(savedOrder.specVersion).toBe(4); // 3 + 1
  });

  it('确认幂等：已 confirmed 不重复 +1', async () => {
    mockChangeRepo.findOne.mockResolvedValueOnce({
      id: 'c1',
      orderId: 'o1',
      status: 'confirmed',
    });
    mockChangeRepo.save.mockImplementation((v) => v);
    await service.confirm('o1', 'c1');
    expect(mockOrdersRepo.save).not.toHaveBeenCalled();
  });

  it('拒绝变更 → rejected', async () => {
    mockChangeRepo.findOne.mockResolvedValueOnce({
      id: 'c1',
      orderId: 'o1',
      status: 'proposed',
    });
    mockChangeRepo.save.mockImplementation((v) => v);
    const change = await service.reject('o1', 'c1');
    expect(change.status).toBe('rejected');
  });

  it('变更记录不存在 → 404', async () => {
    mockChangeRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.confirm('o1', 'missing')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('变更不属于该订单 → 404（归属校验）', async () => {
    mockChangeRepo.findOne.mockResolvedValueOnce({
      id: 'c1',
      orderId: 'other',
      status: 'proposed',
    });
    await expect(service.reject('o1', 'c1')).rejects.toMatchObject({
      status: 404,
    });
  });
});