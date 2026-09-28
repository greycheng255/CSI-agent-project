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
import { LlmChannel } from './llm-channel.entity';
import { LlmChannelService } from './llm-channel.service';
import { LlmChannelAdminController } from './llm-channel-admin.controller';

/** AI 网关直连代理模块（BYOK：按用户配置转发并计量；计费单价与渠道别名表外置 DB） */
@Module({
  imports: [
    TypeOrmModule.forFeature([UserLlmConfig, LlmModelPrice, LlmChannel]),
    AuthModule,
    AdminModule,
    EntitlementModule,
  ],
  controllers: [
    LlmProxyController,
    LlmPriceAdminController,
    LlmChannelAdminController,
  ],
  providers: [LlmProxyService, LlmModelPriceService, LlmChannelService],
  exports: [LlmProxyService, LlmModelPriceService, LlmChannelService],
})
export class LlmProxyModule {}
