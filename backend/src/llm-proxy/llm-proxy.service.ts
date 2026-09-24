import { Injectable, Logger } from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';
import { Readable } from 'stream';
import { ContractError } from '../longtask/contract/errors';
import { EntitlementService, UsageIngestItem } from '../entitlement/entitlement.service';
import { LlmModelPriceService } from './llm-model-price.service';

const UPSTREAM_TIMEOUT_MS = 120_000;

/** 解析 OpenAI 口径路径：baseUrl 以 /v1 结尾则直拼，否则补 /v1 */
function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(trimmed) ? `${trimmed}/chat/completions` : `${trimmed}/v1/chat/completions`;
}

/** 通用端点 URL 构造（chat/completions / embeddings / models） */
function endpointUrl(baseUrl: string, endpoint: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const v1 = /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
  return `${v1}/${endpoint}`;
}

/** OpenAI SDK base_url 目录口径（到 /v1 为止，不含路径） */
function toOpenAiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

/**
 * forward() 结果双模：
 * - json：非流式（或上游未按流式应答），body 已缓冲解析
 * - stream：上游 text/event-stream 直通，upstream 为原始 fetch Response，由 controller 层 pipe 给客户端；
 *   recordStreamUsage 为服务端计量闭包（pipeSseResponse 从收尾帧提取完整 usage 后调用）
 */
export type ForwardResult =
  | { mode: 'json'; status: number; body: unknown }
  | {
      mode: 'stream';
      status: number;
      upstream: globalThis.Response;
      recordStreamUsage: (u: StreamUsage) => void;
    };

/** 流式收尾帧提取的完整用量（chat: prompt/completion_tokens；Responses: input/output_tokens） */
export interface StreamUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/**
 * 将上游 SSE 流式响应直通写入 Express 响应（chat/completions stream=true 专用）。
 * - 设置标准 SSE 头 + X-Accel-Buffering: no（防 nginx 反代缓冲）
 * - 客户端断连 → 销毁管道（undici 随之 abort 上游连接）
 * - 上游中断 → 销毁客户端连接（让 OpenAI SDK 识别为流断开而非空成功）
 */
export function pipeSseResponse(
  res: ExpressResponse,
  upstream: globalThis.Response,
  onStreamUsage?: (u: StreamUsage) => void,
): void {
  const startedAt = Date.now();
  const streamLogger = new Logger('LlmProxyStream');
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  if (!upstream.body) {
    streamLogger.warn('stream upstream body empty, end immediately');
    res.end();
    return;
  }
  const nodeStream = Readable.fromWeb(upstream.body as import('stream/web').ReadableStream);

  // 增量扫描 data: 行捕获收尾 usage 帧（chat 流式已注入 include_usage，上游必返；
  // Responses API 由 response.completed 事件携带）。提取完整 input/output/total：
  // 流正常结束时回调服务端计量（M-F5 修复前该链缺失，流式请求全部不进 E4 账目）。
  let carry = '';
  let usage: StreamUsage | null = null;
  nodeStream.on('data', (chunk: Buffer) => {
    carry += chunk.toString('utf8');
    let idx: number;
    while ((idx = carry.indexOf('\n')) >= 0) {
      const line = carry.slice(0, idx).trim();
      carry = carry.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        // chat chunk: 顶层 usage（prompt/completion/total）；Responses API: response.completed 嵌套 response.usage（input/output/total）
        const frame = JSON.parse(data) as {
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            input_tokens?: number;
            output_tokens?: number;
            total_tokens?: number;
          };
          response?: {
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              input_tokens?: number;
              output_tokens?: number;
              total_tokens?: number;
            };
          };
        };
        const u = frame.usage ?? frame.response?.usage;
        if (u && typeof u.total_tokens === 'number') {
          const input = u.prompt_tokens ?? u.input_tokens ?? 0;
          const output = u.completion_tokens ?? u.output_tokens ?? 0;
          usage = { input_tokens: input, output_tokens: output, total_tokens: u.total_tokens };
        }
      } catch {
        // 非 JSON 行（注释/心跳）忽略
      }
    }
    if (carry.length > 8192) carry = ''; // 防半行粘连无限增长
  });

  nodeStream.on('error', (err) => {
    streamLogger.error(`stream upstream error after ${Date.now() - startedAt}ms: ${String(err)}`);
    if (!res.writableEnded) res.destroy();
  });
  nodeStream.on('end', () => {
    const tokens = usage?.total_tokens;
    streamLogger.log(
      `stream completed in ${Date.now() - startedAt}ms tokens=${typeof tokens === 'number' ? tokens : 'n/a'}`,
    );
    // 流完整结束才计量（中断/断连不计，避免半流入账）
    if (usage && onStreamUsage) {
      try {
        onStreamUsage(usage);
      } catch (err) {
        streamLogger.warn(`stream usage record failed (ignored): ${String(err)}`);
      }
    }
  });
  res.on('close', () => {
    // 正常结束时 writableEnded=true；此处为 false 说明客户端中途断连
    if (!res.writableEnded) {
      const tokens = usage?.total_tokens;
      streamLogger.warn(
        `stream client disconnected after ${Date.now() - startedAt}ms tokens=${typeof tokens === 'number' ? tokens : 'n/a'}`,
      );
      nodeStream.destroy();
    }
  });
  nodeStream.pipe(res);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 计量单价改走 DB（LlmModelPriceService，见表 llm_model_prices）：
 * 内建默认价由 LlmModelPriceService.DEFAULT_MODEL_PRICES 兜底，未登记模型回退 gpt-5.4 价。
 */

/**
 * AI 网关直连代理（BYOK 链路）：
 * 按当前用户解析 user_llm_configs 中配置的网关地址与 Key（AES-256-GCM 解密），
 * 代理转发 /chat/completions，并 best-effort 上报用量计量（BYOK 不拦截、不硬断）。
 */
@Injectable()
export class LlmProxyService {
  private readonly logger = new Logger(LlmProxyService.name);

  constructor(
    private readonly entitlementService: EntitlementService,
    private readonly modelPriceService: LlmModelPriceService,
  ) {}

  /** 计量估算（人民币分）：查 DB 单价，未命中回退 gpt-5.4 价 */
  private estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
    const price = this.modelPriceService.getPriceOrFallback(model);
    return Math.round(
      (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output,
    );
  }

  /** 当前用户的全局 LLM 环境配置（runtime 启动时拉取并注入为环境变量） */
  async runtimeEnv(orgId: string): Promise<{
    env: { OPENAI_BASE_URL: string; OPENAI_API_KEY: string; LLM_PROXY_MODE: string };
    base_url: string;
    api_key: string;
  }> {
    const cfg = await this.entitlementService.resolveLlmConfig(orgId);
    if (!cfg) {
      throw new ContractError(409, 'LLM_CONFIG_MISSING', '尚未配置 AI Token，请前往「配置 AI Token」页完成配置');
    }
    const baseUrl = toOpenAiBaseUrl(cfg.base_url);
    return {
      env: {
        OPENAI_BASE_URL: baseUrl,
        OPENAI_API_KEY: cfg.api_key,
        LLM_PROXY_MODE: cfg.source === 'plan_builtin' ? 'plan-builtin' : cfg.source === 'env_default' ? 'env-default' : 'byok-global',
      },
      base_url: baseUrl,
      api_key: cfg.api_key,
    };
  }

  async forward(
    orgId: string,
    workspaceId: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<ForwardResult> {
    const endpoint = (payload.endpoint as string) || 'chat/completions';
    const isGet = endpoint === 'models';
    const model = typeof payload.model === 'string' ? payload.model : 'unknown';
    // §17：X-Agent-Run-Id 透传落库（bridge 注入 body.agent_run_id；JWT 路径由 controller 注入）
    const agentRunId =
      typeof payload.agent_run_id === 'string' && payload.agent_run_id.trim()
        ? payload.agent_run_id.trim()
        : null;
    const startedAt = Date.now();
    this.logger.log(
      `forward org=${orgId} endpoint=${endpoint} model=${model} stream=${payload.stream === true}` +
        (payload.agent_run_id ? ` run=${String(payload.agent_run_id)}` : '') +
        (workspaceId ? ` ws=${workspaceId}` : ''),
    );
    const cfg = await this.entitlementService.resolveLlmConfig(orgId);
    if (!cfg) {
      throw new ContractError(409, 'LLM_CONFIG_MISSING', '尚未配置 AI Token，请前往「配置 AI Token」页完成配置');
    }
    const apiKey = cfg.api_key;
    const url = endpointUrl(cfg.base_url, endpoint);

    // 转发给上游的干净载荷：剔除内部路由字段
    const { endpoint: _ep, agent_run_id: _runId, ...upstreamPayload } = payload;
    // 流式端点：chat/completions 与 responses（Responses API 流式为 event: response.completed 收尾，自带 usage）
    const wantsStream =
      !isGet &&
      (endpoint === 'chat/completions' || endpoint === 'responses') &&
      upstreamPayload.stream === true;
    // 硬性计量要求：chat 流式必须开启 include_usage，收尾帧携带完整 Usage/Cost
    // （Console daemon 依赖最终帧计量；缺失即计量链断）。Responses API 无此参数。
    if (wantsStream && endpoint === 'chat/completions') {
      upstreamPayload.stream_options = {
        ...((upstreamPayload.stream_options as Record<string, unknown>) ?? {}),
        include_usage: true,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(url, {
        method: isGet ? 'GET' : 'POST',
        headers: isGet
          ? { Authorization: `Bearer ${apiKey}` }
          : { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: isGet ? undefined : JSON.stringify(upstreamPayload),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const reason = (err as Error)?.name === 'AbortError' ? 'upstream-timeout' : 'upstream-unreachable';
      this.logger.error(`forward connect failed (${reason}): ${url}`);
      throw new ContractError(502, 'LLM_UPSTREAM_ERROR', `网关调用失败（${reason}）：${url}`);
    }

    // 流式直通：上游按 text/event-stream 应答时不缓冲整流（旧实现 await text() 会把
    // SSE 拖成"等全流→JSON.parse 失败→空 200"，即 codex 侧 Reconnecting 空转的根因）。
    // 首字节限时由上方 timer 覆盖；长流本身不设总时限（正常生成可持续数分钟）。
    const contentType = upstream.headers.get('content-type') ?? '';
    if (upstream.ok && wantsStream && contentType.includes('text/event-stream')) {
      clearTimeout(timer);
      this.logger.log(
        `forward stream passthrough status=${upstream.status} model=${model} ttfb=${Date.now() - startedAt}ms`,
      );
      // 服务端权威计量闭包：pipeSseResponse 从收尾帧提取 usage 后回调（M-F5：
      // 此前流式不计量导致 E4 停滞、E3 used 恒 0；Console daemon 上报链未接，
      // 计量口径统一切回服务端，daemon 侧无需再上报以免双计）。
      const recordStreamUsage = (u: StreamUsage) => {
        if (!workspaceId || !UUID_RE.test(workspaceId)) return;
        const item: UsageIngestItem = {
          workspace_id: workspaceId,
          agent_run_id: agentRunId,
          model,
          input_tokens: u.input_tokens,
          output_tokens: u.output_tokens,
          total_tokens: u.total_tokens,
          cost_cents: this.estimateCostCents(model, u.input_tokens, u.output_tokens),
        };
        this.entitlementService
          .recordUsage(orgId, [item])
          .catch((err) => this.logger.warn(`llm-proxy stream usage record failed (ignored): ${String(err)}`));
      };
      return { mode: 'stream', status: upstream.status, upstream, recordStreamUsage };
    }

    // 非流式：signal 持续覆盖响应体读取（修复旧实现 clearTimeout 过早、
    // body 停滞时 text() 无限挂死），超时映射为结构化 502。
    let rawText: string | null = null;
    try {
      rawText = await upstream.text();
    } catch (err) {
      clearTimeout(timer);
      const reason =
        (err as Error)?.name === 'AbortError' ? 'upstream-body-timeout' : 'upstream-read-failed';
      this.logger.error(`forward body read failed (${reason}): ${url}`);
      throw new ContractError(502, 'LLM_UPSTREAM_ERROR', `网关响应体读取失败（${reason}）：${url}`);
    }
    clearTimeout(timer);

    let body: unknown = null;
    if (rawText) {
      try {
        body = JSON.parse(rawText);
      } catch {
        body = null;
      }
    }

    // 上游失败统一按契约错误结构映射为 5xx LLM_UPSTREAM_ERROR（RFC7807），
    // 避免"HTTP 201 + error body"令调用方/对账无法按状态码判定成败。
    if (!upstream.ok) {
      const upstreamError =
        body && typeof body === 'object'
          ? (body as { error?: { message?: string }; message?: string })
          : {};
      const upstreamMsg =
        upstreamError?.error?.message ||
        upstreamError?.message ||
        rawText ||
        upstream.statusText;
      this.logger.error(
        `forward upstream error status=${upstream.status} model=${model} elapsed=${Date.now() - startedAt}ms: ${String(upstreamMsg).slice(0, 300)}`,
      );
      throw new ContractError(
        502,
        'LLM_UPSTREAM_ERROR',
        `upstream ${url} responded ${upstream.status}: ${String(upstreamMsg).slice(0, 300)}`,
        { upstream_status: upstream.status },
      );
    }

    // best-effort 计量（BYOK 不拦截）：成功响应按 usage 字段上报；workspace 缺省/非法时跳过（uuid 归集键）。
    // 流式直通路径的服务端计量走 recordStreamUsage 闭包（pipeSseResponse 收尾帧提取）。
    if (body && typeof body === 'object') {
      const usage = (body as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage;
      if (usage && workspaceId && UUID_RE.test(workspaceId)) {
        const item: UsageIngestItem = {
          workspace_id: workspaceId,
          agent_run_id: agentRunId,
          model,
          input_tokens: usage.prompt_tokens ?? 0,
          output_tokens: usage.completion_tokens ?? 0,
          total_tokens: usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
          cost_cents: this.estimateCostCents(model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0),
        };
        this.entitlementService
          .recordUsage(orgId, [item])
          .catch((err) => this.logger.warn(`llm-proxy usage record failed (ignored): ${String(err)}`));
      }
    }

    this.logger.log(
      `forward done status=${upstream.status} mode=json model=${model} elapsed=${Date.now() - startedAt}ms` +
        (body && typeof body === 'object'
          ? ` tokens=${JSON.stringify((body as { usage?: { total_tokens?: number } }).usage?.total_tokens ?? null)}`
          : ''),
    );
    return { mode: 'json', status: upstream.status, body };
  }
}
