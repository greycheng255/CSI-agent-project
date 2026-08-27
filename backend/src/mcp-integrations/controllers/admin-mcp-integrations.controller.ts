import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SuperAdminGuard } from '../../admin/admin.guard';
import {
  MCPAppAuthMode,
  MCPAppDirection,
  MCPAppInvocationDirection,
  MCPAppInvocationStatus,
  MCPAppToolDirection,
  MCPAppTransport,
} from '../entities';
import {
  MCPAppRegistryService,
  MCPAppUpsertInput,
} from '../services/mcp-app-registry.service';
import { MCPIntegrationsService } from '../services/mcp-integrations.service';

type AppBody = {
  code?: string;
  name?: string;
  description?: string | null;
  direction?: MCPAppDirection;
  transport?: MCPAppTransport;
  endpointUrl?: string | null;
  authMode?: MCPAppAuthMode;
  defaultWorkspaceId?: string | null;
  defaultTenantId?: string | null;
  enabled?: boolean;
};

type ExternalCallBody = {
  name: string;
  arguments?: Record<string, unknown>;
  timeoutMs?: number;
  authConfig?: Record<string, unknown>;
  id?: string | number | null;
};

type PlatformCallBody = {
  name: string;
  arguments?: Record<string, unknown>;
  id?: string | number | null;
};

type SubmitTaskBody = {
  platformTaskId?: string | null;
  platformOrderId?: string | null;
  toolName?: string;
  arguments?: Record<string, unknown>;
  timeoutMs?: number;
  authConfig?: Record<string, unknown>;
};

type PollTaskBody = {
  statusToolName?: string;
  arguments?: Record<string, unknown>;
  timeoutMs?: number;
  authConfig?: Record<string, unknown>;
  deliverOnFinal?: boolean;
};

@Controller('api/v1/admin/mcp-integrations')
@UseGuards(SuperAdminGuard)
export class AdminMCPIntegrationsController {
  constructor(
    private readonly appRegistry: MCPAppRegistryService,
    private readonly integrations: MCPIntegrationsService,
  ) {}

  @Get('apps')
  async listApps() {
    return {
      data: await this.appRegistry.listApps(),
    };
  }

  @Post('apps')
  async createApp(@Body() body: AppBody) {
    const app = await this.appRegistry.createApp(this.toAppInput(body));
    return {
      data: this.appRegistry.serializeApp(app),
    };
  }

  @Get('apps/:id')
  async getApp(@Param('id') id: string) {
    const app = await this.appRegistry.getApp(id);
    return {
      data: this.appRegistry.serializeApp(app),
    };
  }

  @Patch('apps/:id')
  async updateApp(@Param('id') id: string, @Body() body: AppBody) {
    const app = await this.appRegistry.updateApp(id, this.toAppInput(body));
    return {
      data: this.appRegistry.serializeApp(app),
    };
  }

  @Post('apps/:id/enable')
  async enableApp(@Param('id') id: string) {
    const app = await this.appRegistry.setEnabled(id, true);
    return {
      data: this.appRegistry.serializeApp(app),
    };
  }

  @Post('apps/:id/disable')
  async disableApp(@Param('id') id: string) {
    const app = await this.appRegistry.setEnabled(id, false);
    return {
      data: this.appRegistry.serializeApp(app),
    };
  }

  @Post('apps/:id/token')
  async issueInboundToken(@Param('id') id: string) {
    return this.appRegistry.issueInboundToken(id);
  }

  @Post('apps/:id/discover-tools')
  async discoverTools(
    @Param('id') id: string,
    @Body() body: { authConfig?: Record<string, unknown> },
  ) {
    return this.integrations.discoverTools(id, body?.authConfig);
  }

  @Get('apps/:id/tools')
  async listTools(
    @Param('id') id: string,
    @Query('direction') direction?: MCPAppToolDirection,
  ) {
    return {
      data: await this.integrations.listTools(id, direction),
    };
  }

  @Patch('tools/:toolId')
  async updateTool(
    @Param('toolId') toolId: string,
    @Body() body: { enabled?: boolean },
  ) {
    return {
      data: await this.integrations.updateTool(toolId, body),
    };
  }

  @Get('apps/:id/platform-tools')
  async listPlatformTools(@Param('id') id: string) {
    return {
      data: await this.integrations.listPlatformTools(id),
    };
  }

  @Patch('apps/:id/platform-tools/:toolName')
  async updatePlatformTool(
    @Param('id') id: string,
    @Param('toolName') toolName: string,
    @Body() body: { enabled?: boolean; rateLimitPerMinute?: number | null },
  ) {
    return {
      data: await this.integrations.updatePlatformToolPermission(
        id,
        toolName,
        body,
      ),
    };
  }

  @Post('apps/:id/sync-capabilities')
  async syncCapabilities(
    @Param('id') id: string,
    @Body() body: { authConfig?: Record<string, unknown> },
  ) {
    return this.integrations.syncCapabilities(id, body?.authConfig);
  }

  @Get('apps/:id/capabilities')
  async listCapabilities(@Param('id') id: string) {
    return {
      data: await this.integrations.listCapabilities(id),
    };
  }

  @Post('apps/:id/test/external-call')
  async testExternalCall(
    @Param('id') id: string,
    @Body() body: ExternalCallBody,
  ) {
    return this.integrations.testExternalCall(id, body);
  }

  @Post('apps/:id/test/platform-call')
  async testPlatformCall(
    @Param('id') id: string,
    @Body() body: PlatformCallBody,
  ) {
    return this.integrations.testPlatformCall(id, body);
  }

  @Get('invocations')
  async listInvocations(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('appId') appId?: string,
    @Query('direction') direction?: MCPAppInvocationDirection,
    @Query('toolName') toolName?: string,
    @Query('status') status?: MCPAppInvocationStatus,
  ) {
    return this.integrations.listInvocations({
      page: Number(page || 1),
      limit: Number(limit || 20),
      appId,
      direction,
      toolName,
      status,
    });
  }

  @Get('invocations/:id')
  async getInvocation(@Param('id') id: string) {
    return this.integrations.getInvocation(id);
  }

  @Post('apps/:id/task-bindings/submit')
  async submitExternalTask(
    @Param('id') id: string,
    @Body() body: SubmitTaskBody,
  ) {
    return this.integrations.submitExternalTask(id, body);
  }

  @Get('task-bindings')
  async listTaskBindings(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('appId') appId?: string,
    @Query('platformTaskId') platformTaskId?: string,
    @Query('platformOrderId') platformOrderId?: string,
    @Query('externalTaskId') externalTaskId?: string,
  ) {
    return this.integrations.listTaskBindings({
      page: Number(page || 1),
      limit: Number(limit || 20),
      appId,
      platformTaskId,
      platformOrderId,
      externalTaskId,
    });
  }

  @Post('task-bindings/:id/poll')
  async pollTaskBinding(
    @Param('id') id: string,
    @Body() body: PollTaskBody,
  ) {
    return this.integrations.pollTaskBinding(id, body || {});
  }

  private toAppInput(body: AppBody): MCPAppUpsertInput {
    return {
      code: body.code,
      name: body.name,
      description: body.description,
      direction: body.direction,
      transport: body.transport,
      endpointUrl: body.endpointUrl,
      authMode: body.authMode,
      defaultWorkspaceId: body.defaultWorkspaceId,
      defaultTenantId: body.defaultTenantId,
      enabled: body.enabled,
    };
  }
}
