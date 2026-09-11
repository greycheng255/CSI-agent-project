import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AccessToken } from './entities/access-token.entity';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { UserOrAdminGuard } from './user-or-admin.guard';
import { AdminModule } from '../admin/admin.module';

// 对外 SSO IdP 已迁移至 Casdoor（122.51.51.177:28000，org=csi），
// 自研 authorize/token/userinfo 端点与 SsoClient/SsoAuthorizationCode 已下线，
// 接入方（Console、openclaw-cli）直连 Casdoor 标准 OIDC 端点。
@Module({
  imports: [TypeOrmModule.forFeature([AccessToken]), AdminModule],
  controllers: [],
  providers: [AuthService, AuthGuard, RolesGuard, UserOrAdminGuard],
  exports: [AuthService, AuthGuard, RolesGuard, UserOrAdminGuard],
})
export class AuthModule {}
