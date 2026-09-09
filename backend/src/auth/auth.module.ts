import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AccessToken } from './entities/access-token.entity';
import { SsoClient } from './entities/sso-client.entity';
import { SsoAuthorizationCode } from './entities/sso-authorization-code.entity';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { UserOrAdminGuard } from './user-or-admin.guard';
import { SsoService } from './sso.service';
import { SsoController } from './sso.controller';
import { OidcService } from './oidc.service';
import { OidcController } from './oidc.controller';
import { OrgController } from '../orgs/org.controller';
import { SsoCodeCleanupCron } from './sso-code-cleanup.cron';
import { AdminModule } from '../admin/admin.module';
import { OrgModule } from '../orgs/org.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccessToken, SsoClient, SsoAuthorizationCode]),
    AdminModule,
    OrgModule,
  ],
  controllers: [SsoController, OidcController, OrgController],
  providers: [
    AuthService,
    SsoService,
    OidcService,
    SsoCodeCleanupCron,
    AuthGuard,
    RolesGuard,
    UserOrAdminGuard,
  ],
  exports: [AuthService, SsoService, OidcService, AuthGuard, RolesGuard, UserOrAdminGuard],
})
export class AuthModule {}
