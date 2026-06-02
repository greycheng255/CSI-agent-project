import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { Order } from '../orders/entities/order.entity';
import { Task } from '../tasks/entities/task.entity';
import { Bid } from '../bids/entities/bid.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Order, Task, Bid])],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
