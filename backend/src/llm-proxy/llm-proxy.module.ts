import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { UserLlmConfig } from '../entitlement/user-llm-config.entity';
import { LlmProxyController } from './llm-proxy.controller';
import { LlmProxyService } from './llm-proxy.service';
import { LlmModelPrice } from './llm-model-price.entity';
import { LlmModelPriceService } from './llm-model-price.service';
import { LlmPriceAdminController } from './llm-price-admin.controller';

/** AI 网关直连代理模块（BYOK：按用户配置转发并计量；计费单价外置 DB） */
@Module({
  imports: [TypeOrmModule.forFeature([UserLlmConfig, LlmModelPrice]), AuthModule, AdminModule, EntitlementModule],
  controllers: [LlmProxyController, LlmPriceAdminController],
  providers: [LlmProxyService, LlmModelPriceService],
  exports: [LlmProxyService, LlmModelPriceService],
})
export class LlmProxyModule {}
