import { Body, Controller, Get, Param, Post, Patch } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import type { CreateWorkspaceInput } from './workspaces.service';

/**
 * Workspace 内部 REST（长任务线，供平台前端使用，不是跨版块 API）。
 */
@Controller('api/v1/longtask/workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  create(@Body() body: CreateWorkspaceInput) {
    return this.workspacesService.create(body);
  }

  @Get('owner/:ownerId')
  findByOwner(@Param('ownerId') ownerId: string) {
    return this.workspacesService.findByOwner(ownerId);
  }

  @Get('slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.workspacesService.findBySlug(slug);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.workspacesService.findById(id);
  }

  @Patch(':id/showcase')
  updateShowcase(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.workspacesService.updateShowcase(id, {
      bio: typeof body.bio === 'string' ? body.bio : undefined,
      capabilityTags: Array.isArray(body.capabilityTags)
        ? (body.capabilityTags as string[])
        : undefined,
      announcement:
        typeof body.announcement === 'string' ? body.announcement : undefined,
      showcaseCases: Array.isArray(body.showcaseCases)
        ? (body.showcaseCases as unknown[])
        : undefined,
      displayStatus:
        body.displayStatus === 'suspended' || body.displayStatus === 'frozen'
          ? body.displayStatus
          : undefined,
      receivePlatformPush:
        typeof body.receivePlatformPush === 'boolean'
          ? body.receivePlatformPush
          : undefined,
      serviceCommitments:
        body.serviceCommitments &&
        typeof body.serviceCommitments === 'object' &&
        !Array.isArray(body.serviceCommitments)
          ? (body.serviceCommitments as Record<string, unknown>)
          : undefined,
    });
  }
}