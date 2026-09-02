import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { HmacGuard } from '../longtask/contract/hmac.guard';
import { GatewayKeysService, IssuedKey } from './gateway-keys.service';
import { GatewayApiKey } from './gateway-key.entity';

/**
 * Workspace 级网关密钥 API（指南(2) §3.7.2 K1-K4，Console daemon 通道硬前置）。
 * 鉴权与 C→M 一致：Bearer LONGTASK_SERVICE_TOKEN + HMAC（HmacGuard）。
 */
@Controller('v1/gateway/keys')
@UseGuards(HmacGuard)
export class GatewayKeysController {
  constructor(private readonly keys: GatewayKeysService) {}

  /** K1 签发（幂等）：同 workspace 重复调用返回同一 key */
  @Post()
  issue(
    @Body()
    body: { org_id?: string; workspace_id?: string },
  ): Promise<IssuedKey> {
    return this.keys.issue(
      body?.org_id ?? '',
      body?.workspace_id ?? '',
    );
  }

  /** K4 轮换：新 key 上线，旧 key 置 rotated */
  @Post(':keyId/rotate')
  rotate(@Param('keyId') keyId: string): Promise<IssuedKey> {
    return this.keys.rotate(keyId);
  }

  /** K3 吊销：即时失效 */
  @Post(':keyId/revoke')
  revoke(@Param('keyId') keyId: string): Promise<{ key_id: string; status: string }> {
    return this.keys.revoke(keyId);
  }

  /** K2 验签注入：daemon 代理换取 workspace/org 归集头 */
  @Post('validate')
  validate(
    @Body() body: { key?: string },
  ): Promise<{ valid: boolean; workspace_id?: string; org_id?: string; key_id?: string }> {
    return this.keys.validate(body?.key ?? '');
  }

  /** workspace 密钥列表（不含明文） */
  @Get()
  list(@Query('workspace_id') workspaceId: string): Promise<GatewayApiKey[]> {
    return this.keys.list(workspaceId ?? '');
  }
}
