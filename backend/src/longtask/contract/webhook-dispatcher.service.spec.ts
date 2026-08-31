import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookOutbox } from './webhook-outbox.entity';
import { WebhookInboundEvent } from './webhook-inbound.entity';
import { MAX_WEBHOOK_ATTEMPTS } from './backoff';

describe('WebhookDispatcherService（投递器契约 §3.1/§4.1）', () => {
  let service: WebhookDispatcherService;

  const mockOutboxRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };
  const mockInboundRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDispatcherService,
        { provide: getRepositoryToken(WebhookOutbox), useValue: mockOutboxRepo },
        {
          provide: getRepositoryToken(WebhookInboundEvent),
          useValue: mockInboundRepo,
        },
      ],
    }).compile();
    service = module.get(WebhookDispatcherService);
  });

  function outboxRow(overrides: Partial<WebhookOutbox> = {}) {
    return {
      id: 'r1',
      eventId: 'e1',
      eventType: 'bid.won',
      targetUrl: 'http://console/v1/webhooks/bid/result',
      payload: {},
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      ...overrides,
    } as WebhookOutbox;
  }

  it('入站去重：首次 true，重复 false', async () => {
    mockInboundRepo.findOne.mockResolvedValueOnce(null);
    mockInboundRepo.create.mockImplementation((v) => v);
    await expect(
      service.recordInbound('e1', 'bid.won', { a: 1 }),
    ).resolves.toBe(true);

    mockInboundRepo.findOne.mockResolvedValueOnce({ id: 1 });
    await expect(
      service.recordInbound('e1', 'bid.won', { a: 1 }),
    ).resolves.toBe(false);
  });

  it('投递 2xx → success', async () => {
    const row = outboxRow();
    mockOutboxRepo.find.mockResolvedValueOnce([row]);
    const sendFn = jest.fn().mockResolvedValue({ status: 200 });

    const result = await service.processDue(new Date(), sendFn);
    expect(result).toEqual({ sent: 1, dead: 0, retried: 0 });
    expect(row.status).toBe('success');
  });

  it('投递 4xx → 不重试直接死信', async () => {
    const row = outboxRow();
    mockOutboxRepo.find.mockResolvedValueOnce([row]);
    const sendFn = jest.fn().mockResolvedValue({ status: 404 });

    const result = await service.processDue(new Date(), sendFn);
    expect(result).toEqual({ sent: 0, dead: 1, retried: 0 });
    expect(row.status).toBe('dead');
    expect(row.lastError).toBe('HTTP 404');
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  it('投递 5xx → 按退避重试且未达上限不进死信', async () => {
    const row = outboxRow();
    mockOutboxRepo.find.mockResolvedValueOnce([row]);
    const sendFn = jest.fn().mockResolvedValue({ status: 502 });
    const now = new Date('2026-08-27T00:00:00Z');

    const result = await service.processDue(now, sendFn);
    expect(result).toEqual({ sent: 0, dead: 0, retried: 1 });
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt?.getTime()).toBe(now.getTime() + 5_000);
  });

  it('投递网络错误 → 按 5xx 语义退避', async () => {
    const row = outboxRow();
    mockOutboxRepo.find.mockResolvedValueOnce([row]);
    const sendFn = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await service.processDue(new Date(), sendFn);
    expect(result.retried).toBe(1);
    expect(row.lastError).toBe('network-error');
  });

  it(`第 ${MAX_WEBHOOK_ATTEMPTS} 次失败 → 死信`, async () => {
    const row = outboxRow({ attempts: MAX_WEBHOOK_ATTEMPTS - 1 });
    mockOutboxRepo.find.mockResolvedValueOnce([row]);
    const sendFn = jest.fn().mockResolvedValue({ status: 503 });

    const result = await service.processDue(new Date(), sendFn);
    expect(result.dead).toBe(1);
    expect(row.status).toBe('dead');
    expect(row.attempts).toBe(MAX_WEBHOOK_ATTEMPTS);
  });

  it('attempts 已达上限的残留行防御性直接死信', async () => {
    const row = outboxRow({ attempts: MAX_WEBHOOK_ATTEMPTS });
    mockOutboxRepo.find.mockResolvedValueOnce([row]);
    const sendFn = jest.fn();

    const result = await service.processDue(new Date(), sendFn);
    expect(result.dead).toBe(1);
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('enqueue 生成 outbox 行（eventId 复用或生成）', async () => {
    mockOutboxRepo.create.mockImplementation((v) => v);
    await service.enqueue('bid.result', 'http://x', { a: 1 });
    expect(mockOutboxRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'bid.result',
        targetUrl: 'http://x',
        status: 'pending',
        attempts: 0,
      }),
    );
  });
});