import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HmacGuard } from '../longtask/contract/hmac.guard';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import {
  EntitlementCreditHold,
  EntitlementFreeGrant,
  EntitlementPaymentOrder,
  EntitlementQuotaPeriod,
  EntitlementUsageRecord,
  OrgSubscription,
} from './entitlement-entities';
import {
  EntitlementPlan,
  EntitlementPlanModel,
} from './entitlement-plan.entity';
import { EntitlementController } from './entitlement.controller';
import { EntitlementAdminController } from './entitlement-admin.controller';
import { EntitlementPortalController } from './entitlement-portal.controller';
import { EntitlementService } from './entitlement.service';
import { UserLlmConfig } from './user-llm-config.entity';

/**
 * AI 网关订阅权益计费模块（DR-12 / PRD §4.6，碳硅平台侧）。
 * 承载 EntitlementPort 商业化面：套餐/权益目录/LLM 额度/用量账单。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      EntitlementPlan,
      EntitlementPlanModel,
      OrgSubscription,
      EntitlementQuotaPeriod,
      EntitlementFreeGrant,
      EntitlementCreditHold,
      EntitlementUsageRecord,
      EntitlementPaymentOrder,
      UserLlmConfig,
    ]),
    AdminModule, // 复用 AdminGuard（运营管理面）
    AuthModule, // 复用 AuthGuard（用户套餐门户，含 AuthService 依赖）
  ],
  controllers: [EntitlementController, EntitlementAdminController, EntitlementPortalController],
  providers: [EntitlementService, HmacGuard],
  exports: [EntitlementService],
})
export class EntitlementModule {}
