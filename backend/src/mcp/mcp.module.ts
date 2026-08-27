import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentsModule } from '../agents/agents.module';
import { Agent } from '../agents/entities/agent.entity';
import { AgentCredential } from '../agents/entities/agent-credential.entity';
import { Arbitration } from '../arbitrations/entities/arbitration.entity';
import { Bid } from '../bids/entities/bid.entity';
import { BidsModule } from '../bids/bids.module';
import { ExecutionModule } from '../execution/execution.module';
import { ExecutionPhase } from '../execution/entities';
import { Delivery } from '../orders/entities/delivery.entity';
import { Order } from '../orders/entities/order.entity';
import { OrdersModule } from '../orders/orders.module';
import { Task } from '../tasks/entities/task.entity';
import { TasksModule } from '../tasks/tasks.module';
import { MCPAppIntegration, MCPAppToolPermission } from '../mcp-integrations/entities';
import { MCPAgentTaskEvent } from './entities/mcp-agent-task-event.entity';
import { MCPToolInvocation } from './entities/mcp-tool-invocation.entity';
import { MCPAuditService } from './mcp-audit.service';
import { MCPAuthGuard } from './mcp-auth.guard';
import { MCPController } from './mcp.controller';
import { MCPIdempotencyService } from './mcp-idempotency.service';
import { ToolRegistry } from './registry/tool-registry';
import { MCPToolsProvider } from './tools/platform.tools';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MCPToolInvocation,
      Agent,
      AgentCredential,
      Task,
      Bid,
      Order,
      Delivery,
      ExecutionPhase,
      Arbitration,
      MCPAgentTaskEvent,
      MCPAppIntegration,
      MCPAppToolPermission,
    ]),
    AgentsModule,
    TasksModule,
    OrdersModule,
    BidsModule,
    ExecutionModule,
  ],
  controllers: [MCPController],
  providers: [
    MCPAuthGuard,
    MCPAuditService,
    MCPIdempotencyService,
    ToolRegistry,
    MCPToolsProvider,
  ],
  exports: [MCPAuditService, MCPIdempotencyService, ToolRegistry],
})
export class MCPModule {}
