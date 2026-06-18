// 首先设置 DB_TYPE 环境变量，确保实体文件能正确检测数据库类型
const isSqliteEnv = process.env.DATABASE_PATH || !process.env.DB_HOST;
if (isSqliteEnv) {
  process.env.DB_TYPE = 'sqlite';
}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AgentsModule } from './agents/agents.module';
import { TasksModule } from './tasks/tasks.module';
import { BidsModule } from './bids/bids.module';
import { OrdersModule } from './orders/orders.module';
import { ArbitrationsModule } from './arbitrations/arbitrations.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PaymentModule } from './payment/payment.module';
import { NotificationsModule } from './notifications/notifications.module';
import { UploadModule } from './upload/upload.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ExecutionModule } from './execution/execution.module';
import { AdminModule } from './admin/admin.module';
import { MetricsModule } from './metrics/metrics.module';
import { User } from './users/entities/user.entity';
import { Agent } from './agents/entities/agent.entity';
import { Task } from './tasks/entities/task.entity';
import { Bid } from './bids/entities/bid.entity';
import { Order } from './orders/entities/order.entity';
import { Delivery } from './orders/entities/delivery.entity';
import { DeliveryRevision } from './orders/entities/delivery-revision.entity';
import { AcceptanceChecklist } from './orders/entities/acceptance-checklist.entity';
import { Arbitration } from './arbitrations/entities/arbitration.entity';
import { AuditLog } from './audit/entities/audit-log.entity';
import { WebhookDelivery } from './webhooks/entities/webhook-delivery.entity';
import { AccessToken } from './auth/entities/access-token.entity';
import { AgentApiKey } from './agents/entities/agent-api-key.entity';
import { AgentAuditLog } from './agents/entities/agent-audit-log.entity';
import { AgentCapability } from './agents/entities/agent-capability.entity';
import { AgentCard } from './agents/entities/agent-card.entity';
import { AgentEmbedding } from './agents/entities/agent-embedding.entity';
import { AgentHeartbeat } from './agents/entities/agent-heartbeat.entity';
import { AgentTag } from './agents/entities/agent-tag.entity';
import { Payment } from './payment/entities/payment.entity';
import { Payout } from './payment/entities/payout.entity';
import { UserPaymentCode } from './payment/entities/user-payment-code.entity';
import { UserBalance, BalanceRecord, Withdrawal } from './payment/entities/balance.entity';
import { PlatformPaymentCode } from './payment/entities/platform-payment-code.entity';
import { OrderPayment } from './payment/entities/order-payment.entity';
import {
  ExecutionPhase,
  ExecutionSubTask,
  ExecutionTrace,
} from './execution/entities';
import { Admin } from './admin/entities/admin.entity';
import { AdminAccessToken } from './admin/entities/admin-access-token.entity';

// 根据环境变量选择数据库类型
const isSqlite = process.env.DATABASE_PATH || !process.env.DB_HOST;

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: isSqlite ? 'sqlite' : 'postgres',
      ...(isSqlite
        ? {
            database: process.env.DATABASE_PATH || '/data/genesis.db',
          }
        : {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5436'),
            username: process.env.DB_USER || 'genesis_user',
            password: process.env.DB_PASSWORD || 'genesis_password',
            database: process.env.DB_NAME || 'genesis_db',
          }),
      entities: [
        User,
        Agent,
        Task,
        Bid,
        Order,
        Delivery,
        DeliveryRevision,
        AcceptanceChecklist,
        Arbitration,
        AuditLog,
        WebhookDelivery,
        AccessToken,
        AgentApiKey,
        AgentAuditLog,
        AgentCapability,
        AgentCard,
        AgentEmbedding,
        AgentHeartbeat,
        AgentTag,
        Payment,
        Payout,
        UserPaymentCode,
        PlatformPaymentCode,
        OrderPayment,
        ExecutionPhase,
        ExecutionSubTask,
        ExecutionTrace,
        // 管理员相关实体
        Admin,
        AdminAccessToken,
        // 余额相关实体
        UserBalance,
        BalanceRecord,
        Withdrawal,
      ],
      synchronize: process.env.DB_SYNC === 'true',
    }),
    UsersModule,
    AgentsModule,
    TasksModule,
    BidsModule,
    OrdersModule,
    ArbitrationsModule,
    WebhooksModule,
    PaymentModule,
    NotificationsModule,
    UploadModule,
    RealtimeModule,
    ExecutionModule,
    AdminModule, // 管理员模块
    MetricsModule, // 业务指标模块
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
