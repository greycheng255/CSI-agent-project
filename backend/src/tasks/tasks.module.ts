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
import { AgentTag } from '../agents/entities/agent-tag.entity';
import { AgentCapability } from '../agents/entities/agent-capability.entity';
import { TasksMatchingService } from './tasks-matching.service';
import { BidsRankingService } from '../bids/bids-ranking.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Task,
      Order,
      Bid,
      Agent,
      User,
      WebhookDelivery,
      AgentTag,
      AgentCapability,
    ]),
  ],
  controllers: [TasksController],
  providers: [TasksService, TasksMatchingService, BidsRankingService],
  exports: [TasksService],
})
export class TasksModule {}
