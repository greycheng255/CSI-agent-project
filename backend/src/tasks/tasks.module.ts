import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { Task } from './entities/task.entity';
import { Order } from '../orders/entities/order.entity';
import { Bid } from '../bids/entities/bid.entity';
import { Agent } from '../agents/entities/agent.entity';
import { User } from '../users/entities/user.entity';
import { WebhookDelivery } from '../webhooks/entities/webhook-delivery.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, Order, Bid, Agent, User, WebhookDelivery]),
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
