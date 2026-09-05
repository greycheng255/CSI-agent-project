import { WorkspaceSyncService } from './workspace-sync.service';
import { WorkspacesService } from './workspaces.service';

describe('WorkspaceSyncService（契约 §21.2 端点一拉取同步）', () => {
  const applyLifecycle = jest.fn().mockResolvedValue({ duplicate: false });
  const service = new WorkspaceSyncService({
    applyLifecycle,
  } as unknown as WorkspacesService);

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CONSOLE_BASE_URL = 'http://console.internal';
  });

  afterEach(() => {
    delete process.env.CONSOLE_BASE_URL;
  });

  it('拉取 {workspaces,next_cursor} 并按 §21.2 字段 upsert（合成 sync-{id}-{updated_at} event id）', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({
        workspaces: [
          { workspace_id: 'w1', name: 'A 工作室', updated_at: '2026-09-04T00:00:00Z' },
        ],
        next_cursor: null,
      }),
    );
    const { upserted, watermark } = await service.syncOnce(
      fetchFn as unknown as typeof fetch,
    );
    expect(upserted).toBe(1);
    expect(watermark).toBe('2026-09-04T00:00:00Z');
    expect(applyLifecycle).toHaveBeenCalledWith(
      'sync-w1-2026-09-04T00:00:00Z',
      'workspace.updated',
      expect.objectContaining({ workspace_id: 'w1' }),
    );
    // §21.1：limit ≤200；HMAC 空 body 签名头齐备
    const calledUrl = new URL(fetchFn.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe('/v1/partner/workspaces');
    expect(calledUrl.searchParams.get('limit')).toBe('200');
    const headers = fetchFn.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer /);
    expect(headers['X-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(headers['X-Request-Id']).toBeTruthy();
  });

  it('next_cursor 非空 → 续页拉取直至翻完', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          workspaces: [{ workspace_id: 'w1', updated_at: '2026-09-01T00:00:00Z' }],
          next_cursor: 'CUR1',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          workspaces: [{ workspace_id: 'w2', updated_at: '2026-09-02T00:00:00Z' }],
          next_cursor: null,
        }),
      );
    const { upserted } = await service.syncOnce(fetchFn as unknown as typeof fetch);
    expect(upserted).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const secondUrl = new URL(fetchFn.mock.calls[1][0] as string);
    expect(secondUrl.searchParams.get('cursor')).toBe('CUR1');
  });

  it('未配置 CONSOLE_BASE_URL → 不发起请求', async () => {
    delete process.env.CONSOLE_BASE_URL;
    const fetchFn = jest.fn();
    await expect(
      service.syncOnce(fetchFn as unknown as typeof fetch),
    ).rejects.toThrow('CONSOLE_BASE_URL is not configured');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('非 2xx → 抛错交由 cron 捕获告警', async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response('', { status: 500 }));
    await expect(
      service.syncOnce(fetchFn as unknown as typeof fetch),
    ).rejects.toThrow('HTTP 500');
  });
});
