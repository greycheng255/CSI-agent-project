import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MarketplaceTasksService } from './marketplace-tasks.service';
import type { CreateMarketplaceTaskInput } from './marketplace-tasks.service';

/**
 * 任务大厅内部 REST（长任务线，供平台前端使用，不是跨版块 API）。
 * C→M 契约端点（/v1/marketplace/*）在阶段二由 contract 控制器实现。
 */
@Controller('api/v1/longtask/marketplace-tasks')
export class MarketplaceTasksController {
  constructor(
    private readonly marketplaceTasksService: MarketplaceTasksService,
  ) {}

  @Post()
  create(@Body() body: CreateMarketplaceTaskInput) {
    return this.marketplaceTasksService.create(body);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @Body() body: { ttlDays?: number }) {
    return this.marketplaceTasksService.publish(id, body.ttlDays);
  }

  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.marketplaceTasksService.close(id);
  }

  @Post(':id/reopen-bidding')
  reopenBidding(@Param('id') id: string) {
    return this.marketplaceTasksService.reopenBidding(id);
  }

  @Get()
  findOpen() {
    return this.marketplaceTasksService.findOpen();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.marketplaceTasksService.findById(id);
  }
}