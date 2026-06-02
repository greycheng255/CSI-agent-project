import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';
import { Order } from '../orders/entities/order.entity';
import { Payment } from './entities/payment.entity';
import { Payout } from './entities/payout.entity';
import { UserPaymentCode } from './entities/user-payment-code.entity';
import { PlatformPaymentCode } from './entities/platform-payment-code.entity';
import { OrderPayment } from './entities/order-payment.entity';
import {
  UserBalance,
  BalanceRecord,
  Withdrawal,
} from './entities/balance.entity';
import { OrdersModule } from '../orders/orders.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { UploadModule } from '../upload/upload.module';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

// 确保上传目录存在
const uploadDir = join(process.cwd(), 'uploads');
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true });
}

// 定义所有需要的子目录
const subDirs = [
  'payment-codes',
  'platform-payment-codes',
  'payment-proofs',
  'payout-proofs',
];
subDirs.forEach((dir) => {
  const dest = join(uploadDir, dir);
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }
});

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      Payment,
      Payout,
      UserPaymentCode,
      PlatformPaymentCode,
      OrderPayment,
      UserBalance,
      BalanceRecord,
      Withdrawal,
    ]),
    MulterModule.register({
      storage: diskStorage({
        destination: (req, file, cb) => {
          // 根据路由决定保存路径
          let folder = 'general';
          if (req.path.includes('platform-codes')) {
            folder = 'platform-payment-codes';
          } else if (req.path.includes('my-codes')) {
            folder = 'payment-codes';
          } else if (req.path.includes('confirm-payment')) {
            folder = 'payment-proofs';
          } else if (req.path.includes('confirm-payout')) {
            folder = 'payout-proofs';
          }
          const dest = join(uploadDir, folder);
          if (!existsSync(dest)) {
            mkdirSync(dest, { recursive: true });
          }
          cb(null, dest);
        },
        filename: (req, file, cb) => {
          const timestamp = Date.now();
          const randomStr = Math.random().toString(36).substring(2, 8);
          cb(null, `${timestamp}-${randomStr}-${file.originalname}`);
        },
      }),
    }),
    OrdersModule,
    WebhooksModule,
    UploadModule,
    AuthModule,
    AdminModule,
  ],
  controllers: [PaymentController, BalanceController],
  providers: [PaymentService, BalanceService],
  exports: [PaymentService, BalanceService],
})
export class PaymentModule {}
