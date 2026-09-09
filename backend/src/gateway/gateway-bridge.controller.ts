import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { HmacGuard } from '../longtask/contract/hmac.guard';
import { ContractError } from '../longtask/contract/errors';
import { GatewayKeysService, IssuedKey } from './gateway-keys.service';
import { LlmProxyService } from '../llm-proxy/llm-proxy.service';

/**
 * 网关计费面契约桥接（Console 集成面 E 族/L 族/K 族）。
 * - E 族（权益/用量）由 EntitlementController 承载（/v1/entitlement/*）
 * - K 族（workspace 级 key）由 GatewayKeysController 承载（/v1/gateway/keys*）
 * - L 族（LLM 调用，BYOK 公测口径）+ K 族契约别名在此桥接
 *
 * 鉴权：服务间 HMAC（HmacGuard，复用长任务契约密钥 c2m-）。
 * L1/L2 daemon 调用时携带 K1 签发的 workspace key（Authorization: Bearer sk-csi-*），
 * 服务端用 key 反查 workspace→org 归属，再按 org 的 BYOK 配置转发到用户网关。
 */
@Controller('v1')
@UseGuards(HmacGuard)
export class GatewayBridgeController {
  constructor(
    private readonly keys: GatewayKeysService,
    private readonly proxy: LlmProxyService,
  ) {}

  // ---------- K 族契约路径别名（/v1/keys/*） ----------

  /** K1 签发 workspace 级 key（契约别名；主路径 /v1/gateway/keys 同样可用） */
  @Post('keys/issue')
  issue(@Body() body: { org_id?: string; workspace_id?: string }): Promise<IssuedKey> {
    return this.keys.issue(body?.org_id ?? '', body?.workspace_id ?? '');
  }

  /** K3 吊销 key（契约别名） */
  @Post('keys/revoke')
  revoke(@Body() body: { key_id?: string }): Promise<{ key_id: string; status: string }> {
    if (!body?.key_id) {
      throw new ContractError(400, 'INVALID_ARGUMENT', 'key_id is required');
    }
    return this.keys.revoke(body.key_id);
  }

  /** K4 轮换 key（契约别名） */
  @Post('keys/:keyId/rotate')
  rotate(@Param('keyId') keyId: string): Promise<IssuedKey> {
    return this.keys.rotate(keyId);
  }

  // ---------- L 族 LLM 调用（BYOK 公测口径：按 org 配置转发） ----------

  /** 从 X-Workspace-Key 头解析 workspace key（Authorization 留给 HmacGuard 验签），反查 org/workspace 归属 */
  private async resolveKey(workspaceKeyHeader: string | undefined): Promise<{
    org_id: string;
    workspace_id: string;
  }> {
    const key = workspaceKeyHeader?.trim();
    if (!key) {
      throw new ContractError(401, 'AUTH_TOKEN_INVALID', 'missing workspace key (X-Workspace-Key header)');
    }
    const result = await this.keys.validate(key);
    if (!result.valid || !result.org_id || !result.workspace_id) {
      throw new ContractError(401, 'AUTH_TOKEN_INVALID', 'invalid or revoked workspace key');
    }
    return { org_id: result.org_id, workspace_id: result.workspace_id };
  }

  /** L1 统一聊天调用入口（OpenAI 兼容） */
  @Post('chat/completions')
  async chatCompletions(
    @Headers('x-workspace-key') workspaceKey: string | undefined,
    @Headers('x-agent-run-id') agentRunId: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const { org_id, workspace_id } = await this.resolveKey(workspaceKey);
    const result = await this.proxy.forward(org_id, workspace_id, {
      ...body,
      ...(agentRunId ? { agent_run_id: agentRunId } : {}),
    });
    return result.body;
  }

  /** L2 向量化（OpenAI 兼容） */
  @Post('embeddings')
  async embeddings(
    @Headers('x-workspace-key') workspaceKey: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const { org_id, workspace_id } = await this.resolveKey(workspaceKey);
    const result = await this.proxy.forward(org_id, workspace_id, {
      ...body,
      endpoint: 'embeddings',
    });
    return result.body;
  }

  /** L3 模型目录（OpenAI 兼容 /v1/models 形态） */
  @Get('models')
  async models(@Headers('x-workspace-key') workspaceKey: string | undefined) {
    const { org_id } = await this.resolveKey(workspaceKey);
    const result = await this.proxy.forward(org_id, undefined, { endpoint: 'models' });
    return result.body;
  }
}
