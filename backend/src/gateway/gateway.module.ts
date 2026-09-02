import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GatewayApiKey } from './gateway-key.entity';
import { GatewayKeysService } from './gateway-keys.service';
import { GatewayKeysController } from './gateway-keys.controller';

@Module({
  imports: [TypeOrmModule.forFeature([GatewayApiKey])],
  providers: [GatewayKeysService],
  controllers: [GatewayKeysController],
  exports: [GatewayKeysService],
})
export class GatewayModule {}
