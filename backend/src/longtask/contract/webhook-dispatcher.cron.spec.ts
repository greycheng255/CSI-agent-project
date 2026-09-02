import { WebhookDispatcherCron } from './webhook-dispatcher.cron';
import { WebhookDispatcherService } from './webhook-dispatcher.service';

describe('WebhookDispatcherCron', () => {
  const originalToken = process.env.LONGTASK_SERVICE_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.LONGTASK_SERVICE_TOKEN;
    else process.env.LONGTASK_SERVICE_TOKEN = originalToken;
  });

  it('sendFn：携带 Bearer + X-Signature（HMAC-SHA256(body+ts)）+ 契约头（X-Request-Id/Idempotency-Key），超时保护', async () => {
    process.env.LONGTASK_SERVICE_TOKEN = 'st-123';
    const fetchMock = jest.fn().mockResolvedValue({ status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const cron = new WebhookDispatcherCron({} as WebhookDispatcherService);
    const payload = { event_id: 'e1', event_type: 'bid.result' };
    const res = await cron.sendFn('http://console.internal/v1/webhooks/bid/result', payload, {
      eventId: 'evt-0001',
      attempt: 1,
    });

    expect(res).toEqual({ status: 200 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://console.internal/v1/webhooks/bid/result');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer st-123');
    // 契约头：X-Request-Id 为 uuid-v7、Idempotency-Key 取 outbox event_id
    expect(init.headers['X-Request-Id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(init.headers['Idempotency-Key']).toBe('evt-0001');

    const sig = init.headers['X-Signature'] as string;
    expect(sig).toMatch(/^t=\d{10},v1=[0-9a-f]{64}$/);
    // 签名可用同口径复算验证（编码 hex，TS L1770 澄清）
    const { createHmac } = jest.requireActual('crypto');
    const ts = Number(sig.match(/t=(\d+)/)![1]);
    const expected = createHmac('sha256', 'st-123')
      .update(JSON.stringify(payload) + ts)
      .digest('hex');
    expect(sig).toContain(`v1=${expected}`);
  });

  it('dispatchDue：未配置 LONGTASK_SERVICE_TOKEN 时不投递', async () => {
    delete process.env.LONGTASK_SERVICE_TOKEN;
    const dispatcher = { processDue: jest.fn() };
    const cron = new WebhookDispatcherCron(dispatcher as never);
    await cron.dispatchDue();
    expect(dispatcher.processDue).not.toHaveBeenCalled();
  });

  it('dispatchDue：配置令牌后调用 processDue（now + sendFn）', async () => {
    process.env.LONGTASK_SERVICE_TOKEN = 'st-123';
    const dispatcher = {
      processDue: jest.fn().mockResolvedValue({ sent: 1, dead: 0, retried: 0 }),
    };
    const cron = new WebhookDispatcherCron(dispatcher as never);
    await cron.dispatchDue();
    expect(dispatcher.processDue).toHaveBeenCalledTimes(1);
    const [now, sendFn] = dispatcher.processDue.mock.calls[0];
    expect(now).toBeInstanceOf(Date);
    expect(typeof sendFn).toBe('function');
  });
});
