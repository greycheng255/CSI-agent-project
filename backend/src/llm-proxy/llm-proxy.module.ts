import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { UserLlmConfig } from '../entitlement/user-llm-config.entity';
import { LlmProxyController } from './llm-proxy.controller';
import { LlmProxyService } from './llm-proxy.service';

/** AI 网关直连代理模块（BYOK：按用户配置转发并计量） */
@Module({
  imports: [TypeOrmModule.forFeature([UserLlmConfig]), AuthModule, EntitlementModule],
  controllers: [LlmProxyController],
  providers: [LlmProxyService],
})
export class LlmProxyModule {}
