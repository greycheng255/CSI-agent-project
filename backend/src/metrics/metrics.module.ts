import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { Task } from '../tasks/entities/task.entity';
import { Bid } from '../bids/entities/bid.entity';
import { Order } from '../orders/entities/order.entity';
import { Agent } from '../agents/entities/agent.entity';
import { User } from '../users/entities/user.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, Bid, Order, Agent, User]),
    AuthModule,
  ],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
