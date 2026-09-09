import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MarketplaceTasksService } from './marketplace-tasks.service';
import { MarketplaceBidsService } from '../marketplace-bids/marketplace-bids.service';
import { SelectionService } from '../marketplace-bids/selection.service';
import { AuthGuard } from '../../auth/auth.guard';
import type { RequestWithUser } from '../../auth/auth.guard';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';
import type { CreateMarketplaceTaskInput } from './marketplace-tasks.service';

/**
 * 任务大厅内部 REST（长任务线，供平台前端使用，不是跨版块 API）。
 * C→M 契约端点（/v1/marketplace/*）在阶段二由 contract 控制器实现。
 */
@Controller('api/v1/longtask/marketplace-tasks')
export class MarketplaceTasksController {
  constructor(
    private readonly marketplaceTasksService: MarketplaceTasksService,
    private readonly bidsService: MarketplaceBidsService,
    private readonly selectionService: SelectionService,
  ) {}

  @Post()
  create(@Body() body: CreateMarketplaceTaskInput) {
    return this.marketplaceTasksService.create(body);
  }

  /** 一步创建并发布：draft → open（前端单次调用，避免 draft 中间态） */
  @Post('create-and-publish')
  createAndPublish(
    @Body() body: CreateMarketplaceTaskInput & { ttlDays?: number },
  ) {
    const { ttlDays, ...input } = body;
    return this.marketplaceTasksService.createAndPublish(input, ttlDays);
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

  /** 雇主选标（PRD §5.6.2）：仅任务发布者本人可操作；成功后创建 Order 并通知 Console */
  @Post(':id/select')
  @UseGuards(AuthGuard)
  async selectBid(
    @Param('id') id: string,
    @Body() body: { bidId?: unknown },
    @Req() req: RequestWithUser,
  ) {
    await this.assertEmployerOwner(id, req.user?.id);
    if (typeof body.bidId !== 'string' || !body.bidId) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        'bidId is required',
      );
    }
    return this.selectionService.selectBid(id, body.bidId);
  }

  /** 雇主全部驳回并重开竞标（PRD §5.6.3）：仅任务发布者本人可操作 */
  @Post(':id/reject-all')
  @UseGuards(AuthGuard)
  async rejectAll(@Param('id') id: string, @Req() req: RequestWithUser) {
    await this.assertEmployerOwner(id, req.user?.id);
    return this.selectionService.rejectAll(id);
  }

  /** 校验任务归属：仅 task.employerUserId（任务发布者）可执行选标/驳回 */
  private async assertEmployerOwner(
    taskId: string,
    userId: string | undefined,
  ) {
    const task = await this.marketplaceTasksService.findById(taskId);
    if (!task) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_TASK,
        `marketplace task not found: ${taskId}`,
      );
    }
    if (!userId || !task.employerUserId || task.employerUserId !== userId) {
      throw new ContractError(
        403,
        CONTRACT_ERROR_CODE.FORBIDDEN,
        'only the task employer can select or reject bids',
      );
    }
  }

  @Get()
  findOpen() {
    return this.marketplaceTasksService.findOpen();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.marketplaceTasksService.findById(id);
  }

  /** 竞标席位列表（综合分排序，含 workspace 名称/头像快照——答复文档六.3） */
  @Get(':id/bids')
  listBids(@Param('id') id: string) {
    return this.bidsService.rank(id);
  }
}