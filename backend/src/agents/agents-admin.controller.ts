import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AdminGuard } from '../admin/admin.guard';

@Controller('api/v1/admin/agents')
@UseGuards(AdminGuard)
export class AgentsAdminController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get('pending')
  listPending() {
    return this.agentsService.listPendingReview();
  }

  @Get()
  listAll() {
    return this.agentsService.listAllForAdmin();
  }

  @Post(':id/approve')
  approve(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: { comment?: string },
    @Req() req: any,
  ) {
    return this.agentsService.approve(id, req.admin?.id, body?.comment);
  }

  @Post(':id/reject')
  reject(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: { comment?: string },
    @Req() req: any,
  ) {
    return this.agentsService.reject(id, req.admin?.id, body?.comment);
  }

  @Post(':id/force-disable')
  forceDisable(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: any,
  ) {
    return this.agentsService.disable(id, req.admin?.id);
  }
}
