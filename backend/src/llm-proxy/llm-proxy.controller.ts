import { Body, Controller, Get, Headers, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';
import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import {
  LlmProxyService,
  pipeSseResponse,
} from './llm-proxy.service';

/**
 * AI 网关直连代理（用户 JWT 鉴权）：
 * 前端/执行侧 POST /api/v1/llm-proxy/chat/completions，
 * 平台按当前用户配置的网关与 Key 转发（OpenAI 接口口径透传；stream=true 时 SSE 直通）。
 * GET /runtime-env 为 runtime 全局配置引导：按当前用户返回标准 OpenAI 环境变量，
 * runtime 启动时拉取并注入（OPENAI_BASE_URL / OPENAI_API_KEY）。
 */
@Controller('api/v1/llm-proxy')
@UseGuards(AuthGuard)
export class LlmProxyController {
  constructor(private readonly proxy: LlmProxyService) {}

  /** runtime 全局配置引导（OpenAI 环境变量口径） */
  @Get('runtime-env')
  runtimeEnv(@Req() req: RequestWithUser) {
    return this.proxy.runtimeEnv(req.user?.id ?? '');
  }

  @Post('chat/completions')
  async chatCompletions(
    @Req() req: RequestWithUser,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Headers('x-agent-run-id') agentRunId: string | undefined,
    @Body() body: Record<string, unknown>,
    @Res() res: ExpressResponse,
  ) {
    const result = await this.proxy.forward(req.user?.id ?? '', workspaceId, {
      ...(body ?? {}),
      ...(agentRunId ? { agent_run_id: agentRunId } : {}),
    });
    if (result.mode === 'stream') {
      pipeSseResponse(res, result.upstream, result.recordStreamUsage);
      return;
    }
    res.status(result.status).json(result.body);
  }
}
