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
import { MarketplaceOrdersService } from '../marketplace-orders/marketplace-orders.service';
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
    private readonly ordersService: MarketplaceOrdersService,
  ) {}

  /** 发布者即雇主：employer_user_id 一律取登录态，忽略 body 传入（防伪造/防无主任务） */
  @Post()
  @UseGuards(AuthGuard)
  create(
    @Body() body: CreateMarketplaceTaskInput,
    @Req() req: RequestWithUser,
  ) {
    return this.marketplaceTasksService.create({
      ...body,
      employerUserId: req.user?.id ?? null,
    });
  }

  /** 一步创建并发布：draft → open（前端单次调用，避免 draft 中间态） */
  @Post('create-and-publish')
  @UseGuards(AuthGuard)
  createAndPublish(
    @Body() body: CreateMarketplaceTaskInput & { ttlDays?: number },
    @Req() req: RequestWithUser,
  ) {
    const { ttlDays, ...input } = body;
    return this.marketplaceTasksService.createAndPublish(
      { ...input, employerUserId: req.user?.id ?? null },
      ttlDays,
    );
  }

  @Post(':id/publish')
  @UseGuards(AuthGuard)
  async publish(
    @Param('id') id: string,
    @Body() body: { ttlDays?: number },
    @Req() req: RequestWithUser,
  ) {
    await this.assertEmployerOwner(id, req.user?.id);
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

  /** 任务取消：selected → cancelled（Spec 超时 / 协商取消达成等；仅任务发布者可操作） */
  @Post(':id/cancel')
  @UseGuards(AuthGuard)
  async cancel(@Param('id') id: string, @Req() req: RequestWithUser) {
    await this.assertEmployerOwner(id, req.user?.id);
    return this.marketplaceTasksService.cancel(id);
  }

  /**
   * 校验任务归属：选标/驳回/取消/发布只能由任务雇主本人执行。
   * 无主任务（employer_user_id 为空，历史/外部导入）由当前登录用户在首次操作时认领归属。
   */
  private async assertEmployerOwner(
    taskId: string,
    userId: string | undefined,
  ) {
    if (!userId) {
      throw new ContractError(
        403,
        CONTRACT_ERROR_CODE.FORBIDDEN,
        'login required: only the task employer can act on the task',
      );
    }
    const task = await this.marketplaceTasksService.claimEmployer(taskId, userId);
    return task;
  }

  @Get()
  findOpen() {
    return this.marketplaceTasksService.findOpen();
  }

  /**
   * 雇主「我的长任务」：本人发布的任务大厅任务 + 当前轮竞标摘要 + 关联签约订单。
   * 供工作台「我的任务」页展示竞标动态（谁投了标、报价多少）与选标/签约入口。
   */
  @Get('mine')
  @UseGuards(AuthGuard)
  async listMine(@Req() req: RequestWithUser) {
    const userId = req.user?.id;
    if (!userId) {
      throw new ContractError(
        403,
        CONTRACT_ERROR_CODE.FORBIDDEN,
        'login required: only the task employer can list own tasks',
      );
    }
    const tasks = await this.marketplaceTasksService.listByEmployer(userId);
    const taskIds = tasks.map((t) => t.id);
    const [orders, ...bidsPerTask] = await Promise.all([
      this.ordersService.listByTaskIds(taskIds),
      ...taskIds.map((id) => this.bidsService.rank(id)),
    ]);
    const orderByTask = new Map(
      orders.map((o) => [o.marketplaceTaskId, o]),
    );
    return tasks.map((task, index) => ({
      ...task,
      bids: (bidsPerTask[index] ?? []).map((ranked) => ({
        id: ranked.bid.id,
        workspaceId: ranked.bid.workspaceId,
        workspaceName: ranked.workspaceName,
        workspaceLogoUrl: ranked.workspaceLogoUrl,
        priceCny: ranked.bid.priceCny,
        planSummary: ranked.bid.planSummary,
        estimatedDeliveryAt: ranked.bid.estimatedDeliveryAt,
        source: ranked.bid.source,
        status: ranked.bid.status,
        platformRecommended: ranked.platformRecommended,
        createdAt: ranked.bid.createdAt,
      })),
      orderId: orderByTask.get(task.id)?.id ?? null,
      orderContractStatus: orderByTask.get(task.id)?.contractStatus ?? null,
    }));
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