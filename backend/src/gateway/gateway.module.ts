import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GatewayApiKey } from './gateway-key.entity';
import { GatewayKeysService } from './gateway-keys.service';
import { GatewayKeysController } from './gateway-keys.controller';
import { GatewayBridgeController } from './gateway-bridge.controller';
import { LlmProxyModule } from '../llm-proxy/llm-proxy.module';

@Module({
  imports: [TypeOrmModule.forFeature([GatewayApiKey]), LlmProxyModule],
  providers: [GatewayKeysService],
  controllers: [GatewayKeysController, GatewayBridgeController],
  exports: [GatewayKeysService],
})
export class GatewayModule {}
