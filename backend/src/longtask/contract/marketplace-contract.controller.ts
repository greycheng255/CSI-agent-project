import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { HmacGuard } from './hmac.guard';
import { MarketplaceBidsService } from '../marketplace-bids/marketplace-bids.service';
import { CancelSkeletonService } from '../marketplace-orders/cancel-skeleton.service';
import { DeliveryContractService } from '../marketplace-orders/delivery-contract.service';
import { MarketplaceOrdersService } from '../marketplace-orders/marketplace-orders.service';
import { RevisionNegotiationService } from '../marketplace-orders/revision-negotiation.service';
import { SpecContractService } from '../marketplace-orders/spec-contract.service';
import { SpecChangeService } from '../marketplace-orders/spec-change.service';
import { MarketplaceTasksService } from '../marketplace-tasks/marketplace-tasks.service';
import { DisputesService } from '../disputes/disputes.service';
import { SettlementsService } from '../settlements/settlements.service';

/**
 * C→M 契约控制器（Console 调 Marketplace，平台提供 26 个 API 的一部分）。
 * 全部端点统一 HMAC 验签（对接指南 §3.1）。
 * 阶段二：场景一/二/三 + 对账；阶段三：场景四 + 场景八骨架；
 * 阶段四：场景五（deliverables）六（修订协商）七（Spec 变更）。
 */
@Controller('v1/marketplace')
@UseGuards(HmacGuard)
export class MarketplaceContractController {
  constructor(
    private readonly tasksService: MarketplaceTasksService,
    private readonly bidsService: MarketplaceBidsService,
    private readonly ordersService: MarketplaceOrdersService,
    private readonly specService: SpecContractService,
    private readonly cancelService: CancelSkeletonService,
    private readonly deliveryService: DeliveryContractService,
    private readonly negotiationService: RevisionNegotiationService,
    private readonly specChangeService: SpecChangeService,
    private readonly settlementsService: SettlementsService,
    private readonly disputesService: DisputesService,
  ) {}

  /** 场景一 #2：商机 Pull（Console 每 5min 定时器 + 手动） */
  @Get('tasks')
  listTasks() {
    return this.tasksService.findOpen();
  }

  /** 场景一 #3：任务详情 */
  @Get('tasks/:id')
  getTask(@Param('id') id: string) {
    return this.tasksService.findById(id);
  }

  /** 场景二 #4：提交竞标方案并占席位（席位满 409 CONFLICT_SEAT_FULL） */
  @Post('tasks/:id/bids')
  submitBid(
    @Param('id') id: string,
    @Body()
    body: {
      workspace_id?: unknown;
      price_cny?: unknown;
      plan_summary?: unknown;
      estimated_delivery_at?: unknown;
      source?: unknown;
    },
  ) {
    const workspaceId = body.workspace_id;
    if (typeof workspaceId !== 'string' || !workspaceId) {
      throw new Error('workspace_id is required');
    }
    const priceCny = Number(body.price_cny);
    return this.bidsService.submit({
      taskId: id,
      workspaceId,
      priceCny,
      planSummary:
        typeof body.plan_summary === 'string' ? body.plan_summary : undefined,
      estimatedDeliveryAt: body.estimated_delivery_at
        ? String(body.estimated_delivery_at)
        : undefined,
      source: body.source === 'push' || body.source === 'manual_assign'
        ? body.source
        : 'pull',
    });
  }

  /** 场景三 #6：Console 回填 project_id（幂等，容忍异步窗口） */
  @Patch('orders/:id')
  patchOrder(
    @Param('id') id: string,
    @Body() body: { project_id?: unknown },
  ) {
    const projectId = body.project_id;
    if (typeof projectId !== 'string' || !projectId) {
      throw new Error('project_id is required');
    }
    return this.ordersService.applyProjectId(id, projectId);
  }

  /** 对账 #37：订单状态查询（Console 每 10min 对账） */
  @Get('orders/:id/status')
  orderStatus(@Param('id') id: string) {
    return this.ordersService.orderStatus(id);
  }

  /** 对账 #38：Workspace 订单列表 */
  @Get('workspaces/:wid/orders')
  workspaceOrders(@Param('wid') wid: string) {
    return this.ordersService.listByWorkspace(wid);
  }

  /** 场景四 #9：Console 推 Mention 给雇主 */
  @Post('orders/:id/employer-mentions')
  employerMentions(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.specService.receiveEmployerMention(id, body);
  }

  /** 场景四 #11：Console 提交 Spec（启动 7 天计时） */
  @Post('orders/:id/spec')
  submitSpec(
    @Param('id') id: string,
    @Body()
    body: {
      spec_content?: unknown;
      spec_hash?: unknown;
      milestones?: unknown;
    },
  ) {
    return this.specService.submitSpec(id, {
      specContent: body.spec_content,
      specHash: typeof body.spec_hash === 'string' ? body.spec_hash : null,
      milestones: Array.isArray(body.milestones)
        ? (body.milestones as SubmitSpecMilestone[])
        : undefined,
    });
  }

  /** 场景八 #25：Owner 响应协商取消（counter_proposal M5 前 422） */
  @Post('cancel-requests/:id/respond')
  cancelRespond(
    @Param('id') id: string,
    @Body() body: { response?: unknown },
  ) {
    const response = body.response;
    if (response !== 'accept' && response !== 'reject' && response !== 'counter_proposal') {
      throw new Error('response must be accept/reject/counter_proposal');
    }
    return this.cancelService.respond(id, response);
  }

  /** 场景八 #26：Console 超时自动处理结果 */
  @Post('cancel-requests/:id/auto-resolve')
  cancelAutoResolve(@Param('id') id: string, @Body() body: { outcome?: unknown }) {
    if (body.outcome !== 'accept_partial_settlement' && body.outcome !== 'reject_cancel') {
      throw new Error('outcome must be accept_partial_settlement/reject_cancel');
    }
    return this.cancelService.autoResolve(id, body.outcome);
  }

  /** 场景八 #28：最终确认取消结算 */
  @Post('cancel-requests/:id/finalize')
  cancelFinalize(@Param('id') id: string) {
    return this.cancelService.finalize(id);
  }

  /** 场景八 #30：转纠纷 */
  @Post('cancel-requests/:id/to-dispute')
  cancelToDispute(@Param('id') id: string) {
    return this.cancelService.toDispute(id);
  }

  /** 场景五 #13：Console 提交交付物（启动 14 天验收计时） */
  @Post('orders/:id/deliverables')
  submitDeliverables(
    @Param('id') id: string,
    @Body()
    body: {
      metadata?: unknown;
      artifact_urls?: unknown;
      submission_seq?: unknown;
    },
  ) {
    return this.deliveryService.submitDeliverable(id, {
      metadata:
        body.metadata && typeof body.metadata === 'object'
          ? (body.metadata as Record<string, unknown>)
          : null,
      artifactUrls: Array.isArray(body.artifact_urls)
        ? (body.artifact_urls as string[])
        : null,
      submissionSeq:
        typeof body.submission_seq === 'number' ? body.submission_seq : undefined,
    });
  }

  /** 场景六 #15：启动修订协商窗口（2 天） */
  @Post('revision-negotiation/start')
  startNegotiation(@Body() body: { order_id?: unknown; reason?: unknown }) {
    if (typeof body.order_id !== 'string' || !body.order_id) {
      throw new Error('order_id is required');
    }
    return this.negotiationService.start(
      body.order_id,
      typeof body.reason === 'string' ? body.reason : 'revision_exhausted',
    );
  }

  /** 场景六 #16：4 选项决策（A 追加修订 / B Spec 变更 / C 接受当前 / D 转纠纷） */
  @Post('revision-negotiation/:id/decide')
  decideNegotiation(@Param('id') id: string, @Body() body: { decision?: unknown }) {
    if (body.decision !== 'A' && body.decision !== 'B' && body.decision !== 'C' && body.decision !== 'D') {
      throw new Error('decision must be A/B/C/D');
    }
    return this.negotiationService.decide(id, body.decision);
  }

  /** 场景七 #19：Console 判定修订/新增需求 */
  @Post('revision-requests/:id/classify')
  classifyRevision(
    @Param('id') id: string,
    @Body() body: { classification?: unknown },
  ) {
    if (body.classification !== 'revision' && body.classification !== 'new_requirement') {
      throw new Error('classification must be revision/new_requirement');
    }
    return this.specChangeService.classify(id, body.classification);
  }

  /** 场景七 #21：变更提案（3 天对方响应计时） */
  @Post('spec-changes')
  proposeSpecChange(
    @Body() body: { order_id?: unknown; change_seq?: unknown; payload?: unknown },
  ) {
    if (typeof body.order_id !== 'string' || !body.order_id) {
      throw new Error('order_id is required');
    }
    const changeSeq = typeof body.change_seq === 'number' ? body.change_seq : 1;
    return this.specChangeService.propose(body.order_id, changeSeq, {
      payload: body.payload ?? null,
    });
  }

  /** 场景七 #22：确认变更（Spec version+1） */
  @Post('spec-changes/:id/confirm')
  confirmSpecChange(@Param('id') id: string) {
    return this.specChangeService.confirm(id);
  }

  /** 场景七 #23：拒绝变更 */
  @Post('spec-changes/:id/reject')
  rejectSpecChange(@Param('id') id: string) {
    return this.specChangeService.reject(id);
  }

  /** 场景九 #31：触发结算（7 天托管期；平台备数据，划款交关联方） */
  @Post('settlement/trigger')
  triggerSettlement(@Body() body: { order_id?: unknown }) {
    if (typeof body.order_id !== 'string' || !body.order_id) {
      throw new Error('order_id is required');
    }
    return this.settlementsService.trigger(body.order_id);
  }

  /** 对账 #35：查询结算状态 */
  @Get('orders/:id/settlement')
  orderSettlement(@Param('id') id: string) {
    return this.settlementsService.getByOrder(id);
  }

  /** 对账 #36：Workspace 结算列表 */
  @Get('workspaces/:wid/settlements')
  workspaceSettlements(@Param('wid') wid: string) {
    return this.settlementsService.listByWorkspace(wid);
  }

  /** 场景十 #40：Agent Owner 提交举证 */
  @Post('disputes/:id/evidence')
  disputeEvidence(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.disputesService.submitEvidence(id, body);
  }

  /** 场景十 #43：确认仲裁结果（终态） */
  @Post('disputes/:id/acknowledge')
  disputeAcknowledge(@Param('id') id: string) {
    return this.disputesService.acknowledge(id);
  }
}

type SubmitSpecMilestone = {
  key?: string;
  weight?: number;
  status?: string;
};