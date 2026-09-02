import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DisputesService } from './disputes.service';
import { MarketplaceDispute } from './dispute.entity';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';

describe('DisputesService（T22：3 天举证 + 7 天裁定 + 4 选项 + 终态确认）', () => {
  let service: DisputesService;

  const mockDisputeRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn() };
  const mockDispatcher = { enqueue: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DisputesService,
        {
          provide: getRepositoryToken(MarketplaceDispute),
          useValue: mockDisputeRepo,
        },
        { provide: WebhookDispatcherService, useValue: mockDispatcher },
      ],
    }).compile();
    service = module.get(DisputesService);
  });

  it('纠纷发起：3 天举证窗口 + 投递 dispute-raised', async () => {
    mockDisputeRepo.create.mockImplementation((v) => v);
    mockDisputeRepo.save.mockImplementation((v) => ({ ...v, id: 'd1' }));

    const dispute = await service.raiseDispute('o1', '交付质量问题');
    const windowMs = dispute.evidenceDeadline!.getTime() - Date.now();
    expect(windowMs).toBeGreaterThan(3 * 24 * 60 * 60 * 1000 - 5000);
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'project.dispute_raised',
      expect.stringContaining('/v1/webhooks/project/dispute-raised'),
      expect.objectContaining({ dispute_id: 'd1', order_id: 'o1' }),
    );
  });

  it('举证提交：evidence_open/arbitrating 可提交，resolved 拒绝', async () => {
    mockDisputeRepo.findOne.mockResolvedValueOnce({ id: 'd1', orderId: 'o1', status: 'evidence_open' });
    mockDisputeRepo.save.mockImplementation((v) => v);
    await service.submitEvidence('o1', 'd1', { files: ['a'] });

    mockDisputeRepo.findOne.mockResolvedValueOnce({ id: 'd1', orderId: 'o1', status: 'resolved' });
    await expect(
      service.submitEvidence('o1', 'd1', { files: ['b'] }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('启动仲裁：7 天裁定窗口 + 投递 arbitration-started', async () => {
    mockDisputeRepo.findOne.mockResolvedValueOnce({ id: 'd1', orderId: 'o1', status: 'evidence_open' });
    mockDisputeRepo.save.mockImplementation((v) => v);

    const dispute = await service.startArbitration('d1');
    expect(dispute.status).toBe('arbitrating');
    const windowMs = dispute.arbitrationDeadline!.getTime() - Date.now();
    expect(windowMs).toBeGreaterThan(7 * 24 * 60 * 60 * 1000 - 5000);
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'dispute.arbitration_started',
      expect.stringContaining('/v1/webhooks/dispute/arbitration-started'),
      expect.objectContaining({ dispute_id: 'd1', order_id: 'o1' }),
    );
  });

  it('仲裁结果六值：四类资金处置 + resume_execution/closed 零结算出口（A1 项）', async () => {
    mockDisputeRepo.findOne.mockResolvedValueOnce({ id: 'd1', orderId: 'o1', status: 'arbitrating' });
    mockDisputeRepo.save.mockImplementation((v) => v);

    const dispute = await service.resolve('d1', 'partial_settlement', 4_000);
    expect(dispute.resolution).toBe('partial_settlement');
    expect(dispute.resolutionAmountCny).toBe(4_000);
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'dispute.arbitration_result',
      expect.stringContaining('/v1/webhooks/dispute/arbitration-result'),
      expect.objectContaining({ outcome: 'partial_settlement', resolution: 'partial_settlement', amount_cny: 4_000 }),
    );

    // G6：取消不成立回执行（零结算）
    mockDisputeRepo.findOne.mockResolvedValueOnce({ id: 'd2', orderId: 'o1', status: 'arbitrating' });
    await service.resolve('d2', 'resume_execution');
    expect(mockDispatcher.enqueue).toHaveBeenLastCalledWith(
      'dispute.arbitration_result',
      expect.any(String),
      expect.objectContaining({ outcome: 'resume_execution', amount_cny: null }),
    );

    // G3：平台裁定关闭（零结算）
    mockDisputeRepo.findOne.mockResolvedValueOnce({ id: 'd3', orderId: 'o1', status: 'arbitrating' });
    await service.resolve('d3', 'closed');
    expect(mockDispatcher.enqueue).toHaveBeenLastCalledWith(
      'dispute.arbitration_result',
      expect.any(String),
      expect.objectContaining({ outcome: 'closed', amount_cny: null }),
    );

    // 零结算出口不得携带金额
    mockDisputeRepo.findOne.mockResolvedValueOnce({ id: 'd4', orderId: 'o1', status: 'arbitrating' });
    await expect(service.resolve('d4', 'closed', 100)).rejects.toMatchObject({ status: 400 });
  });

  it('终态确认 acknowledge：resolved → acknowledged；未裁不可确认', async () => {
    mockDisputeRepo.findOne.mockResolvedValueOnce({ id: 'd1', orderId: 'o1', status: 'resolved' });
    mockDisputeRepo.save.mockImplementation((v) => v);
    const dispute = await service.acknowledge('o1', 'd1');
    expect(dispute.status).toBe('acknowledged');

    mockDisputeRepo.findOne.mockResolvedValueOnce({ id: 'd1', orderId: 'o1', status: 'arbitrating' });
    await expect(service.acknowledge('o1', 'd1')).rejects.toMatchObject({ status: 422 });
  });

  it('举证窗口 3 天到期 → 自动进入仲裁', async () => {
    mockDisputeRepo.find.mockResolvedValueOnce([
      { id: 'd1', orderId: 'o1', status: 'evidence_open', evidenceDeadline: new Date('2026-08-20T00:00:00Z') },
    ]);
    mockDisputeRepo.findOne.mockResolvedValueOnce({ id: 'd1', orderId: 'o1', status: 'evidence_open' });
    mockDisputeRepo.save.mockImplementation((v) => v);

    const count = await service.scanEvidenceDeadlines(new Date('2026-08-27T00:00:00Z'));
    expect(count).toBe(1);
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith(
      'dispute.arbitration_started',
      expect.any(String),
      expect.objectContaining({ dispute_id: 'd1' }),
    );
  });

  it('纠纷不存在 → 404', async () => {
    mockDisputeRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.acknowledge('o1', 'missing')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('纠纷不属于该订单 → 404（归属校验）', async () => {
    mockDisputeRepo.findOne.mockResolvedValueOnce({ id: 'd1', orderId: 'other', status: 'resolved' });
    await expect(service.acknowledge('o1', 'd1')).rejects.toMatchObject({
      status: 404,
    });
  });
});