import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';
import { AgentsRegistryController } from './agents-registry.controller';
import { AgentsAdminController } from './agents-admin.controller';
import { AgentManagerService } from './agent-manager.service';
import { AgentManagerController } from './agent-manager.controller';
import { AgentBindController } from './agent-bind.controller';
import { AgentCardService } from './agent-card.service';
import { AgentsHealthService } from './agents-health.service';
import { AgentsHealthCron } from './agents-health.cron';
import { AgentsDiscoveryService } from './agents-discovery.service';
import { Agent } from './entities/agent.entity';
import { AgentCredential } from './entities/agent-credential.entity';
import { AgentCard } from './entities/agent-card.entity';
import { AgentCapability } from './entities/agent-capability.entity';
import { AgentTag } from './entities/agent-tag.entity';
import { AgentHeartbeat } from './entities/agent-heartbeat.entity';
import { AgentAuditLog } from './entities/agent-audit-log.entity';
import { AgentEmbedding } from './entities/agent-embedding.entity';
import { User } from '../users/entities/user.entity';
import { WebhookDelivery } from '../webhooks/entities/webhook-delivery.entity';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Agent,
      AgentCredential,
      AgentCard,
      AgentCapability,
      AgentTag,
      AgentHeartbeat,
      AgentAuditLog,
      AgentEmbedding,
      User,
      WebhookDelivery,
    ]),
    HttpModule,
    AuthModule,
    AdminModule,
    forwardRef(() => UsersModule),
  ],
  controllers: [
    AgentsController,
    AgentsRegistryController,
    AgentsAdminController,
    AgentManagerController,
    AgentBindController,
  ],
  providers: [
    AgentsService,
    AgentManagerService,
    AgentCardService,
    AgentsHealthService,
    AgentsHealthCron,
    AgentsDiscoveryService,
  ],
  exports: [
    AgentsService,
    AgentManagerService,
    AgentCardService,
    AgentsHealthService,
    AgentsDiscoveryService,
  ],
})
export class AgentsModule {}
