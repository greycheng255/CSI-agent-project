import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContractError } from '../longtask/contract/errors';
import { decryptKey } from '../gateway/gateway-keys.service';
import { EntitlementService, UsageIngestItem } from '../entitlement/entitlement.service';
import { UserLlmConfig } from '../entitlement/user-llm-config.entity';

const UPSTREAM_TIMEOUT_MS = 120_000;

/** 解析 OpenAI 口径路径：baseUrl 以 /v1 结尾则直拼，否则补 /v1 */
function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(trimmed) ? `${trimmed}/chat/completions` : `${trimmed}/v1/chat/completions`;
}

/** OpenAI SDK base_url 目录口径（到 /v1 为止，不含路径） */
function toOpenAiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 估算金额单价表（人民币分 / 百万 tokens，输入/输出分开计价）。
 * BYOK 场景下平台侧展示口径（实际费用由用户网关/OneLLM 侧结算）。
 * 未登记模型回退 gpt-5.4 价。调整口径时改此处即可。
 */
const MODEL_UNIT_PRICES: Record<string, { input: number; output: number }> = {
  'gpt-5.4': { input: 200, output: 800 }, // ¥2/M 输入 · ¥8/M 输出
  'gpt-5.5': { input: 400, output: 1600 }, // ¥4/M 输入 · ¥16/M 输出（旗舰）
};
const FALLBACK_PRICE = MODEL_UNIT_PRICES['gpt-5.4'];

function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_UNIT_PRICES[model] ?? FALLBACK_PRICE;
  return Math.round((inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output);
}

/**
 * AI 网关直连代理（BYOK 链路）：
 * 按当前用户解析 user_llm_configs 中配置的网关地址与 Key（AES-256-GCM 解密），
 * 代理转发 /chat/completions，并 best-effort 上报用量计量（BYOK 不拦截、不硬断）。
 */
@Injectable()
export class LlmProxyService {
  private readonly logger = new Logger(LlmProxyService.name);

  constructor(
    @InjectRepository(UserLlmConfig)
    private readonly llmConfigRepo: Repository<UserLlmConfig>,
    private readonly entitlementService: EntitlementService,
  ) {}

  /** 当前用户的全局 LLM 环境配置（runtime 启动时拉取并注入为环境变量） */
  async runtimeEnv(orgId: string): Promise<{
    env: { OPENAI_BASE_URL: string; OPENAI_API_KEY: string; LLM_PROXY_MODE: string };
    base_url: string;
    api_key: string;
  }> {
    const row = await this.llmConfigRepo.findOne({ where: { orgId } });
    if (!row) {
      throw new ContractError(409, 'LLM_CONFIG_MISSING', '尚未配置 AI Token，请前往「配置 AI Token」页完成配置');
    }
    const baseUrl = toOpenAiBaseUrl(row.baseUrl);
    const apiKey = decryptKey(row.apiKeyEnc);
    return {
      env: {
        OPENAI_BASE_URL: baseUrl,
        OPENAI_API_KEY: apiKey,
        LLM_PROXY_MODE: 'byok-global',
      },
      base_url: baseUrl,
      api_key: apiKey,
    };
  }

  async forward(
    orgId: string,
    workspaceId: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> {
    const row = await this.llmConfigRepo.findOne({ where: { orgId } });
    if (!row) {
      throw new ContractError(409, 'LLM_CONFIG_MISSING', '尚未配置 AI Token，请前往「配置 AI Token」页完成配置');
    }
    const apiKey = decryptKey(row.apiKeyEnc);
    const url = chatCompletionsUrl(row.baseUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = (err as Error)?.name === 'AbortError' ? 'upstream-timeout' : 'upstream-unreachable';
      throw new ContractError(502, 'LLM_UPSTREAM_ERROR', `网关调用失败（${reason}）：${url}`);
    } finally {
      clearTimeout(timer);
    }

    const body: unknown = await upstream.json().catch(() => null);

    // best-effort 计量（BYOK 不拦截）：成功响应按 usage 字段上报；workspace 缺省/非法时跳过（uuid 归集键）
    if (upstream.ok && body && typeof body === 'object') {
      const usage = (body as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage;
      const model = typeof payload.model === 'string' ? payload.model : 'unknown';
      if (usage && workspaceId && UUID_RE.test(workspaceId)) {
        const item: UsageIngestItem = {
          workspace_id: workspaceId,
          agent_run_id: null,
          model,
          input_tokens: usage.prompt_tokens ?? 0,
          output_tokens: usage.completion_tokens ?? 0,
          total_tokens: usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
          cost_cents: estimateCostCents(model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0),
        };
        this.entitlementService
          .recordUsage(orgId, [item])
          .catch((err) => this.logger.warn(`llm-proxy usage record failed (ignored): ${String(err)}`));
      }
    }

    return { status: upstream.status, body };
  }
}
