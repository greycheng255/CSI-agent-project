import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Arbitration } from './entities/arbitration.entity';
import { ArbitrationsController } from './arbitrations.controller';
import { ArbitrationsService } from './arbitrations.service';
import { OrdersModule } from '../orders/orders.module';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Arbitration]),
    OrdersModule,
    AuthModule,
    AdminModule,
  ],
  controllers: [ArbitrationsController],
  providers: [ArbitrationsService],
})
export class ArbitrationsModule {}
