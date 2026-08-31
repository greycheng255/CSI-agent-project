import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CancelSkeletonService } from './cancel-skeleton.service';
import { MarketplaceCancelRequest } from './cancel-request.entity';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';

describe('CancelSkeletonService（T16b：场景八骨架 + counter_proposal 422）', () => {
  let service: CancelSkeletonService;

  const mockRepo = { findOne: jest.fn(), save: jest.fn(), create: jest.fn() };
  const mockDispatcher = { enqueue: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CancelSkeletonService,
        {
          provide: getRepositoryToken(MarketplaceCancelRequest),
          useValue: mockRepo,
        },
        { provide: WebhookDispatcherService, useValue: mockDispatcher },
      ],
    }).compile();
    service = module.get(CancelSkeletonService);
  });

  it('发起协商取消：建请求 + 投递 project.cancel_request', async () => {
    mockRepo.create.mockImplementation((v) => v);
    mockRepo.save.mockImplementation((v) => ({ ...v, id: 'cr-1' }));

    const request = await service.initiateCancel('o1', 'employer', 'p1');
    expect(request.status).toBe('open');
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'project.cancel_request',
      expect.stringContaining('/v1/webhooks/project/cancel-request'),
      expect.objectContaining({
        event_type: 'project.cancel_request',
        request_id: 'cr-1',
        order_id: 'o1',
        project_id: 'p1',
        trigger: 'employer',
      }),
    );
  });

  it('respond accept → accepted', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ id: 'cr-1', status: 'open' });
    mockRepo.save.mockImplementation((v) => v);
    const req = await service.respond('cr-1', 'accept');
    expect(req.status).toBe('accepted');
  });

  it('respond reject → rejected', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ id: 'cr-1', status: 'open' });
    mockRepo.save.mockImplementation((v) => v);
    const req = await service.respond('cr-1', 'reject');
    expect(req.status).toBe('rejected');
  });

  it('respond counter_proposal：反提案受理 + 投递 cancel-counter-response（T19b 放开）', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 'cr-1', orderId: 'o1', status: 'open' });
    mockRepo.save.mockImplementation((v) => v);
    const req = await service.respond('cr-1', 'counter_proposal');
    expect(req.status).toBe('counter_proposed');
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'project.cancel_counter_response',
      expect.stringContaining('/v1/webhooks/project/cancel-counter-response'),
      expect.objectContaining({
        event_type: 'project.cancel_counter_response',
        request_id: 'cr-1',
        order_id: 'o1',
        owner_response: 'counter_proposal',
      }),
    );
  });

  it('auto-resolve：执行中→同意取消部分结算', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ id: 'cr-1', status: 'open' });
    mockRepo.save.mockImplementation((v) => v);
    const req = await service.autoResolve('cr-1', 'accept_partial_settlement');
    expect(req.status).toBe('accepted');
    expect(req.resolution).toBe('auto_resolved');
  });

  it('auto-resolve：待验收→拒绝取消', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ id: 'cr-1', status: 'open' });
    mockRepo.save.mockImplementation((v) => v);
    const req = await service.autoResolve('cr-1', 'reject_cancel');
    expect(req.status).toBe('rejected');
  });

  it('finalize：投递 cancel-resolution(auto_settled)', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ id: 'cr-1', orderId: 'o1', status: 'accepted' });
    mockRepo.save.mockImplementation((v) => v);
    await service.finalize('cr-1');
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'project.cancel_resolution',
      expect.stringContaining('/v1/webhooks/project/cancel-resolution'),
      expect.objectContaining({ resolution: 'auto_settled' }),
    );
  });

  it('to-dispute：投递 cancel-resolution(to_dispute)', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ id: 'cr-1', orderId: 'o1', status: 'open' });
    mockRepo.save.mockImplementation((v) => v);
    await service.toDispute('cr-1');
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'project.cancel_resolution',
      expect.any(String),
      expect.objectContaining({ resolution: 'to_dispute' }),
    );
  });

  it('请求不存在 → 404', async () => {
    mockRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.respond('missing', 'accept')).rejects.toMatchObject({
      status: 404,
    });
  });
});