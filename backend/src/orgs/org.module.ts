import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Org } from './entities/org.entity';
import { OrgService } from './org.service';

/**
 * 统一账户体系 Org 模块（纯 provider 叶子模块，无循环依赖）。
 *
 * 被 AuthModule（OidcService/SsoController/OrgController 注入 org_id claim
 * 与解析）与 UsersModule（注册/短信登录时自动绑定 org）共同消费。
 *
 * OrgController（/api/v1/orgs/*）复用 AuthGuard/AdminGuard，故注册在
 * AuthModule 而非此处，避免 Auth↔Org 循环依赖。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Org])],
  providers: [OrgService],
  exports: [OrgService],
})
export class OrgModule {}
