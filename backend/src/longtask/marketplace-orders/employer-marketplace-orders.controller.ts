import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import type { RequestWithUser } from '../../auth/auth.guard';
import { MarketplaceOrdersService } from './marketplace-orders.service';
import { SpecContractService } from './spec-contract.service';
import { DeliveryContractService } from './delivery-contract.service';
import { CancelSkeletonService } from './cancel-skeleton.service';
import { SpecChangeService } from './spec-change.service';
import { DisputesService } from '../disputes/disputes.service';
import { MarketplaceTasksService } from '../marketplace-tasks/marketplace-tasks.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';

/**
 * 雇主侧订单操作（平台前端，长任务线内部 REST）。
 * 读取：
 *  - GET  /                                    我的订单列表（含任务标题 / 中标工作室）
 *  - GET  /:id                                 订单详情（Spec 快照与里程碑、交付物、协商/纠纷状态）
 * 覆盖契约中「由 Marketplace 侧雇主动作触发 M→C 事件」的全部入口：
 *  - POST /:id/spec-action                     场景四 #12 spec.confirmed / spec.rejected
 *  - POST /:id/review                          场景五 #14 delivery.accepted/rejected/revision_requested
 *  - POST /:id/spec-change-requests            场景七 #18 spec_change.requested
 *  - POST /:id/spec-changes/:changeId/confirm   场景七 #20 spec_change.employer_confirmed/rejected
 *  - POST /:id/cancel-requests                 场景八 #24 project.cancel_request
 *  - POST /:id/disputes                        场景十 #33/#39 project.dispute_raised
 */
@Controller('api/v1/longtask/employer/orders')
export class EmployerMarketplaceOrdersController {
  constructor(
    private readonly ordersService: MarketplaceOrdersService,
    private readonly specContractService: SpecContractService,
    private readonly deliveryContractService: DeliveryContractService,
    private readonly cancelSkeletonService: CancelSkeletonService,
    private readonly specChangeService: SpecChangeService,
    private readonly disputesService: DisputesService,
    private readonly tasksService: MarketplaceTasksService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  /** 我的订单列表（雇主视角，按下单时间倒序） */
  @Get()
  @UseGuards(AuthGuard)
  async list(@Req() req: RequestWithUser) {
    const orders = await this.ordersService.listByEmployer(
      this.requireUserId(req.user?.id),
    );
    const taskIds = [...new Set(orders.map((order) => order.marketplaceTaskId))];
    const workspaceIds = [...new Set(orders.map((order) => order.workspaceId))];
    const [tasks, workspaces] = await Promise.all([
      Promise.all(taskIds.map((id) => this.tasksService.findById(id))),
      Promise.all(workspaceIds.map((id) => this.workspacesService.findById(id))),
    ]);
    const taskTitles = new Map(
      tasks.filter((t) => !!t).map((t) => [t!.id, t!.title]),
    );
    const workspaceNames = new Map(
      workspaces.filter((w) => !!w).map((w) => [w!.id, w!.name]),
    );
    return orders.map((order) => ({
      ...order,
      taskTitle: taskTitles.get(order.marketplaceTaskId) ?? null,
      workspaceName: workspaceNames.get(order.workspaceId) ?? null,
    }));
  }

  /** 订单详情：Spec 快照/版本/里程碑、交付物、最新取消协商与纠纷 */
  @Get(':id')
  @UseGuards(AuthGuard)
  async detail(@Param('id') orderId: string, @Req() req: RequestWithUser) {
    const order = await this.assertOrderEmployer(orderId, req.user?.id);
    const [task, workspace, deliveries, latestCancelRequest, latestDispute] =
      await Promise.all([
        this.tasksService.findById(order.marketplaceTaskId),
        this.workspacesService.findById(order.workspaceId),
        this.deliveryContractService.listByOrder(orderId),
        this.ordersService.latestCancelRequest(orderId),
        this.disputesService.findLatestByOrder(orderId),
      ]);
    return {
      order,
      task,
      workspace,
      deliveries,
      latestCancelRequest,
      latestDispute,
    };
  }

  /** 登录态取用户 id（未登录 → 403；雇主动作均要求本人身份） */
  private requireUserId(userId?: string): string {
    if (!userId) {
      throw new ContractError(
        403,
        CONTRACT_ERROR_CODE.FORBIDDEN,
        'login required: only the order employer can read the order',
      );
    }
    return userId;
  }

  /**
   * 校验订单归属：验收/确认 Spec/取消/纠纷只能由订单雇主本人执行；
   * 无主订单（employer_user_id 为空）由当前登录用户首次操作时认领。
   */
  private async assertOrderEmployer(orderId: string, userId?: string) {
    return this.ordersService.claimEmployer(orderId, this.requireUserId(userId));
  }

  /** 场景四 #12：雇主确认 / 驳回 Spec（7 天计时由平台侧登记） */
  @Post(':id/spec-action')
  @UseGuards(AuthGuard)
  async specAction(
    @Param('id') orderId: string,
    @Body() body: { action?: unknown; reason?: unknown },
    @Req() req: RequestWithUser,
  ) {
    await this.assertOrderEmployer(orderId, req.user?.id);
    const action = body.action;
    if (action !== 'confirmed' && action !== 'rejected') {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        "action must be 'confirmed' or 'rejected'",
      );
    }
    return this.specContractService.employerAction(
      orderId,
      action,
      typeof body.reason === 'string' ? body.reason : null,
    );
  }

  /** 场景五 #14：雇主验收结果（accepted / rejected / revision_requested） */
  @Post(':id/review')
  @UseGuards(AuthGuard)
  async review(
    @Param('id') orderId: string,
    @Body() body: { action?: unknown; reason?: unknown },
    @Req() req: RequestWithUser,
  ) {
    await this.assertOrderEmployer(orderId, req.user?.id);
    const action = body.action;
    if (
      action !== 'accepted' &&
      action !== 'rejected' &&
      action !== 'revision_requested'
    ) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        "action must be 'accepted' | 'rejected' | 'revision_requested'",
      );
    }
    return this.deliveryContractService.employerReview(
      orderId,
      action,
      typeof body.reason === 'string' ? body.reason : null,
    );
  }

  /** 场景七 #18：雇主发起 Spec 变更/修订请求（启动 Console 24h 判定） */
  @Post(':id/spec-change-requests')
  @UseGuards(AuthGuard)
  async requestSpecChange(
    @Param('id') orderId: string,
    @Body() body: { change_seq?: unknown; payload?: unknown },
    @Req() req: RequestWithUser,
  ) {
    await this.assertOrderEmployer(orderId, req.user?.id);
    const changeSeq =
      typeof body.change_seq === 'number' && body.change_seq > 0
        ? body.change_seq
        : 1;
    return this.specChangeService.employerRequestChange(orderId, changeSeq, {
      payload: body.payload ?? null,
    });
  }

  /** 场景七 #20：雇主对「新增需求」判定二次确认 */
  @Post(':id/spec-changes/:changeId/confirm')
  @UseGuards(AuthGuard)
  async confirmSpecChange(
    @Param('id') orderId: string,
    @Param('changeId') changeId: string,
    @Body() body: { decision?: unknown },
    @Req() req: RequestWithUser,
  ) {
    const decision = body.decision;
    if (decision !== 'confirmed' && decision !== 'rejected') {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        "decision must be 'confirmed' or 'rejected'",
      );
    }
    await this.assertOrderEmployer(orderId, req.user?.id);
    return this.specChangeService.employerConfirm(orderId, changeId, decision);
  }

  /** 场景八 #24：雇主发起协商取消（3 天 Agent Owner 响应计时归 Console） */
  @Post(':id/cancel-requests')
  @UseGuards(AuthGuard)
  async requestCancel(
    @Param('id') orderId: string,
    @Req() req: RequestWithUser,
  ) {
    const order = await this.assertOrderEmployer(orderId, req.user?.id);
    return this.cancelSkeletonService.initiateCancel(
      orderId,
      'employer',
      order.projectId,
    );
  }

  /** 签约托管支付（余额）：按订单价（元）扣款入平台托管，支付后等待 Console 推 Spec */
  @Post(':id/pay-with-balance')
  @UseGuards(AuthGuard)
  payWithBalance(@Param('id') orderId: string, @Req() req: RequestWithUser) {
    return this.ordersService.payWithBalance(
      orderId,
      this.requireUserId(req.user?.id),
    );
  }

  /** 场景十 #33/#39：雇主发起纠纷（7 天申诉期内；3 天举证窗口） */
  @Post(':id/disputes')
  @UseGuards(AuthGuard)
  async raiseDispute(
    @Param('id') orderId: string,
    @Body() body: { reason?: unknown },
    @Req() req: RequestWithUser,
  ) {
    await this.assertOrderEmployer(orderId, req.user?.id);
    return this.disputesService.raiseDispute(
      orderId,
      typeof body.reason === 'string' ? body.reason : null,
    );
  }
}
