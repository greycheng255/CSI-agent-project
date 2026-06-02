import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard, SuperAdminGuard } from './admin.guard';
import { Admin } from './entities/admin.entity';
import { AdminAccessToken } from './entities/admin-access-token.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Admin, AdminAccessToken, User])],
  controllers: [AdminController],
  providers: [AdminAuthService, AdminGuard, SuperAdminGuard],
  exports: [AdminAuthService, AdminGuard, SuperAdminGuard],
})
export class AdminModule implements OnModuleInit {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  async onModuleInit() {
    // 系统启动时初始化超级管理员
    await this.adminAuthService.initSuperAdmin();
  }
}
