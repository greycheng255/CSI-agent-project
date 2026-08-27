import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from '../admin/admin.module';
import { MCPModule } from '../mcp/mcp.module';
import { OrdersModule } from '../orders/orders.module';
import { AdminMCPIntegrationsController } from './controllers/admin-mcp-integrations.controller';
import {
  MCPAppCapability,
  MCPAppIntegration,
  MCPAppInvocation,
  MCPAppTool,
  MCPAppToolPermission,
  MCPTaskBinding,
} from './entities';
import { MCPAppRegistryService } from './services/mcp-app-registry.service';
import { MCPClientService } from './services/mcp-client.service';
import { MCPIntegrationsService } from './services/mcp-integrations.service';

@Module({
  imports: [
    AdminModule,
    MCPModule,
    OrdersModule,
    TypeOrmModule.forFeature([
      MCPAppIntegration,
      MCPAppTool,
      MCPAppCapability,
      MCPAppToolPermission,
      MCPAppInvocation,
      MCPTaskBinding,
    ]),
  ],
  controllers: [AdminMCPIntegrationsController],
  providers: [MCPAppRegistryService, MCPClientService, MCPIntegrationsService],
  exports: [MCPAppRegistryService, MCPClientService, MCPIntegrationsService],
})
export class MCPIntegrationsModule {}
