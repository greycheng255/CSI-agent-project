import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';
import { AgentManagerService } from './agent-manager.service';
import { AgentManagerController } from './agent-manager.controller';
import { AgentBindController } from './agent-bind.controller';
import { Agent } from './entities/agent.entity';
import { AgentApiKey } from './entities/agent-api-key.entity';
import { User } from '../users/entities/user.entity';
import { WebhookDelivery } from '../webhooks/entities/webhook-delivery.entity';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Agent, AgentApiKey, User, WebhookDelivery]),
    HttpModule,
    AuthModule,
    AdminModule,
    forwardRef(() => UsersModule),
  ],
  controllers: [AgentsController, AgentManagerController, AgentBindController],
  providers: [AgentsService, AgentManagerService],
  exports: [AgentsService, AgentManagerService],
})
export class AgentsModule {}
