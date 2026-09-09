import { Controller, Get } from '@nestjs/common';
import { OidcService } from './oidc.service';

/**
 * OIDC Discovery（根路径，与 IdP issuer 对齐）。
 *
 * Console 的 AuthPort CSIAdapter 通过 `${issuer}/.well-known/openid-configuration`
 * 自动发现 authorize / token / userinfo 端点与签名算法。
 *
 * 注意：HS256 为对称签名，discovery 不暴露 jwks_uri；Console 侧配置同一
 * SSO_OIDC_SIGNING_SECRET 即可验签 id_token。
 */
@Controller()
export class OidcController {
  constructor(private readonly oidcService: OidcService) {}

  @Get('.well-known/openid-configuration')
  discovery() {
    return this.oidcService.getDiscovery();
  }
}
