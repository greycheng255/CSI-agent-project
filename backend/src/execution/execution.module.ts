import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExecutionService } from './execution.service';
import { ExecutionController } from './execution.controller';
import { ExecutionPhase, ExecutionSubTask, ExecutionTrace } from './entities';
import { Order } from '../orders/entities/order.entity';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExecutionPhase,
      ExecutionSubTask,
      ExecutionTrace,
      Order,
    ]),
    forwardRef(() => WebhooksModule),
  ],
  providers: [ExecutionService],
  controllers: [ExecutionController],
  exports: [ExecutionService],
})
export class ExecutionModule {}
