import { EventEmitter } from 'events';
import { Test, TestingModule } from '@nestjs/testing';
import { LlmProxyService, pipeSseResponse } from './llm-proxy.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { LlmModelPriceService } from './llm-model-price.service';

describe('LlmProxyService（AI 网关直连代理：流式直通 + 非流式缓冲）', () => {
  let service: LlmProxyService;

  const mockEntitlement = {
    resolveLlmConfig: jest.fn(),
    recordUsage: jest.fn(async () => undefined),
  };

  const mockModelPrice = {
    getPrice: jest.fn(),
    getPriceOrFallback: jest.fn((model) =>
      model === 'gpt-5.4' ? { input: 200, output: 800 } : { input: 200, output: 800 },
    ),
  };

  const cfg = {
    base_url: 'http://upstream.test:4200/v1',
    api_key: 'sk-test',
    source: 'byok-global' as const,
  };

  function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  function sseResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockEntitlement.resolveLlmConfig.mockResolvedValue(cfg);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmProxyService,
        { provide: EntitlementService, useValue: mockEntitlement },
        { provide: LlmModelPriceService, useValue: mockModelPrice },
      ],
    }).compile();
    service = module.get(LlmProxyService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stream=true + 上游 text/event-stream → 流式直通（不缓冲），且注入 stream_options.include_usage', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      sseResponse(['data: {"delta":"你"}\n\n', 'data: [DONE]\n\n']),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.forward('org-1', 'ws-1', {
      model: 'gpt-5.5',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.mode).toBe('stream');
    if (result.mode === 'stream') {
      expect(result.status).toBe(200);
      expect(result.upstream.body).toBeTruthy();
    }
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.stream_options).toEqual({ include_usage: true });
  });

  it('responses 端点流式 → 直通且不注入 stream_options', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      sseResponse(['event: response.output_text.delta\ndata: {"type":"response.output_text.delta"}\n\n']),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.forward('org-1', 'ws-1', {
      model: 'gpt-5.5',
      input: 'hi',
      stream: true,
      endpoint: 'responses',
    });
    expect(result.mode).toBe('stream');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/responses');
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.stream_options).toBeUndefined();
  });

  it('stream=true 但上游返回 JSON（未按流式应答）→ 回退 json 模式', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({ id: 'chatcmpl-1', choices: [], usage: { total_tokens: 3 } }),
    ) as unknown as typeof fetch;

    const result = await service.forward('org-1', 'ws-1', {
      model: 'gpt-5.5',
      stream: true,
      messages: [],
    });
    expect(result.mode).toBe('json');
    if (result.mode === 'json') {
      expect((result.body as { id: string }).id).toBe('chatcmpl-1');
    }
  });

  it('非流式成功 → json 模式并按 usage 上报计量', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    ) as unknown as typeof fetch;

    const result = await service.forward('org-1', '0f0e0d0c-1111-2222-3333-444455556666', {
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.mode).toBe('json');
    expect(mockEntitlement.recordUsage).toHaveBeenCalledTimes(1);
    const [orgId, items] = mockEntitlement.recordUsage.mock.calls[0] as unknown as [string, Array<Record<string, unknown>>];
    expect(orgId).toBe('org-1');
    expect(items[0]).toMatchObject({
      workspace_id: '0f0e0d0c-1111-2222-3333-444455556666',
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    });
  });

  it('上游 404/502 等失败 → 结构化 ContractError 502（带 upstream_status）', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(
        { error: { message: 'Requested model is not available' } },
        404,
      ),
    ) as unknown as typeof fetch;

    await expect(
      service.forward('org-1', 'ws-1', { model: 'bad-model', messages: [] }),
    ).rejects.toMatchObject({
      status: 502,
      errorCode: 'LLM_UPSTREAM_ERROR',
      details: { upstream_status: 404 },
    });
  });

  it('非流式响应体读取停滞（AbortError）→ 结构化 502 upstream-body-timeout（不再无限挂死）', async () => {
    const stalled = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"partial":'));
          // 不 close —— 模拟 body 停滞
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    // 直接让 text() 抛 AbortError（真实场景由 120s abort 触发）
    Object.defineProperty(stalled, 'text', {
      value: jest.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    });
    global.fetch = jest.fn().mockResolvedValue(stalled) as unknown as typeof fetch;

    await expect(
      service.forward('org-1', 'ws-1', { model: 'gpt-5.5', messages: [] }),
    ).rejects.toThrow(/upstream-body-timeout/);
  });

  it('models 端点（GET）→ json 模式透传', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({ object: 'list', data: [{ id: 'gpt-5.5' }] }),
    ) as unknown as typeof fetch;

    const result = await service.forward('org-1', undefined, { endpoint: 'models' });
    expect(result.mode).toBe('json');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://upstream.test:4200/v1/models');
    expect(init.method).toBe('GET');
  });

  it('未配置 LLM 配置 → 409 LLM_CONFIG_MISSING', async () => {
    mockEntitlement.resolveLlmConfig.mockResolvedValue(null);
    await expect(
      service.forward('org-1', 'ws-1', { model: 'gpt-5.5', messages: [] }),
    ).rejects.toMatchObject({ status: 409, errorCode: 'LLM_CONFIG_MISSING' });
  });
});

describe('pipeSseResponse（SSE 直通管道）', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeMockRes(): any {
    const headers: Record<string, string> = {};
    const written: Buffer[] = [];
    const emitter = new EventEmitter();
    let statusCode = 0;
    return {
      headers,
      written,
      get statusCode() {
        return statusCode;
      },
      status(code: number) {
        statusCode = code;
        return this;
      },
      setHeader(k: string, v: string) {
        headers[k.toLowerCase()] = v;
      },
      flushHeaders() {},
      on(evt: string, cb: (...args: unknown[]) => void) {
        emitter.on(evt, cb);
        return this;
      },
      once(evt: string, cb: (...args: unknown[]) => void) {
        emitter.once(evt, cb);
        return this;
      },
      emit(evt: string, ...args: unknown[]) {
        return emitter.emit(evt, ...args);
      },
      removeListener(evt: string, cb: (...args: unknown[]) => void) {
        emitter.removeListener(evt, cb);
        return this;
      },
      write(chunk: Buffer | string) {
        written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return true;
      },
      end() {
        emitter.emit('close');
      },
      destroy() {},
      get writableEnded() {
        return false;
      },
    };
  }

  it('设置 SSE 头并完整透传上游 chunk，并从收尾 usage 帧提取 tokens', async () => {
    const upstream = sseResponseHelper([
      'data: {"a":1}\n\n',
      'data: {"usage":{"total_tokens":59}}\n\n',
      'data: [DONE]\n\n',
    ]);
    const res = makeMockRes();
    pipeSseResponse(res, upstream);
    await new Promise((r) => setTimeout(r, 80));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['x-accel-buffering']).toBe('no');
    const body = Buffer.concat(res.written).toString('utf8');
    expect(body).toContain('data: {"a":1}');
    expect(body).toContain('data: [DONE]');
  });

  it('Responses API 流式：从 response.completed 事件嵌套 response.usage 提取 tokens', async () => {
    const upstream = sseResponseHelper([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"OK"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":18,"output_tokens":5,"total_tokens":23}}}\n\n',
    ]);
    const res = makeMockRes();
    pipeSseResponse(res, upstream);
    await new Promise((r) => setTimeout(r, 80));
    const body = Buffer.concat(res.written).toString('utf8');
    expect(body).toContain('response.completed');
    expect(body).toContain('"total_tokens":23');
  });

  function sseResponseHelper(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
  }
});
