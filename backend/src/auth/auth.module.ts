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
import { SsoCodeCleanupCron } from './sso-code-cleanup.cron';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccessToken, SsoClient, SsoAuthorizationCode]),
    AdminModule,
  ],
  controllers: [SsoController],
  providers: [
    AuthService,
    SsoService,
    SsoCodeCleanupCron,
    AuthGuard,
    RolesGuard,
    UserOrAdminGuard,
  ],
  exports: [AuthService, SsoService, AuthGuard, RolesGuard, UserOrAdminGuard],
})
export class AuthModule {}
