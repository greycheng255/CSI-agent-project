import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from './admin.module';
import { AdminMCPController } from './admin-mcp.controller';
import { MCPModule } from '../mcp/mcp.module';
import { MCPToolInvocation } from '../mcp/entities/mcp-tool-invocation.entity';

@Module({
  imports: [
    AdminModule,
    MCPModule,
    TypeOrmModule.forFeature([MCPToolInvocation]),
  ],
  controllers: [AdminMCPController],
})
export class AdminMCPModule {}
