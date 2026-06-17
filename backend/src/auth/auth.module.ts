import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AccessToken } from './entities/access-token.entity';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { UserOrAdminGuard } from './user-or-admin.guard';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [TypeOrmModule.forFeature([AccessToken]), AdminModule],
  providers: [AuthService, AuthGuard, RolesGuard, UserOrAdminGuard],
  exports: [AuthService, AuthGuard, RolesGuard, UserOrAdminGuard],
})
export class AuthModule {}
