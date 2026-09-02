import { Body, Controller, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { LlmProxyService } from './llm-proxy.service';

/**
 * AI 网关直连代理（用户 JWT 鉴权）：
 * 前端/执行侧 POST /api/v1/llm-proxy/chat/completions，
 * 平台按当前用户配置的网关与 Key 转发（OpenAI 接口口径透传）。
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
    @Body() body: Record<string, unknown>,
  ) {
    const result = await this.proxy.forward(req.user?.id ?? '', workspaceId, body ?? {});
    return result.body;
  }
}
