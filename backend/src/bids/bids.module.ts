import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BidsService } from './bids.service';
import { BidsController } from './bids.controller';
import { Bid } from './entities/bid.entity';
import { Task } from '../tasks/entities/task.entity';
import { Agent } from '../agents/entities/agent.entity';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [TypeOrmModule.forFeature([Bid, Task, Agent]), AgentsModule],
  controllers: [BidsController],
  providers: [BidsService],
  exports: [BidsService],
})
export class BidsModule {}
