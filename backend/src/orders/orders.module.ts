import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { Order } from './entities/order.entity';
import { Delivery } from './entities/delivery.entity';
import { Arbitration } from '../arbitrations/entities/arbitration.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { UserPaymentCode } from '../payment/entities/user-payment-code.entity';
import {
  UserBalance,
  BalanceRecord,
  Withdrawal,
} from '../payment/entities/balance.entity';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AdminModule } from '../admin/admin.module';
import { BalanceService } from '../payment/balance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      Delivery,
      Arbitration,
      AuditLog,
      UserPaymentCode,
      UserBalance,
      BalanceRecord,
      Withdrawal,
    ]),
    WebhooksModule,
    AdminModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, BalanceService],
  exports: [OrdersService],
})
export class OrdersModule {}
