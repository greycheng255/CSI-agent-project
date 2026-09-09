import { Body, Controller, Get, Param, Post, Patch, Req, UseGuards } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import type { CreateWorkspaceInput } from './workspaces.service';
import { AuthGuard } from '../../auth/auth.guard';
import type { RequestWithUser } from '../../auth/auth.guard';

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

  /**
   * 默认 Workspace 自动开通（PRD §4.1/§4.2）：Owner 登录态调用，无工作室时自动创建默认工作室，
   * 已有则幂等返回。前端在「我的工作室」/ 手动参与竞标等无工作室场景引导调用。
   */
  @Post('ensure-default')
  @UseGuards(AuthGuard)
  ensureDefault(
    @Req() req: RequestWithUser,
    @Body() body: { displayName?: unknown },
  ) {
    const ownerId = req.user?.id;
    if (!ownerId) {
      throw new Error('owner is required');
    }
    return this.workspacesService.ensureDefaultForOwner({
      ownerUserId: ownerId,
      displayName:
        typeof body.displayName === 'string' ? body.displayName : (req.user?.displayName ?? null),
    });
  }

  /** 已入驻工作室画廊（公开档案白名单字段，仅 active） */
  @Get('gallery')
  gallery() {
    return this.workspacesService.listGallery();
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
      categoryIds: Array.isArray(body.categoryIds)
        ? (body.categoryIds as string[])
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