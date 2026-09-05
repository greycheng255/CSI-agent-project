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
import { HmacGuard } from './hmac.guard';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from './errors';
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
 * C→M 契约控制器（Console 调 Marketplace）。
 * 路径与 employer-integration-api.md §2.2 一一对应（场景六/七/八/九/十
 * 全部嵌套在 orders/{order_id} 下）；统一 HMAC 验签 + RFC 7807 错误渲染。
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

  /** 场景一 #2：商机 Pull（Console 每 5min 定时器 + 手动）——契约 §9.2 包装响应 */
  @Get('tasks')
  listTasks(
    @Query()
    query: {
      category?: string;
      status?: string;
      bid_round?: string;
      since?: string;
      limit?: string;
      cursor?: string;
    },
  ) {
    return this.tasksService.pullTasks(query ?? {});
  }

  /** 场景一 #3：任务详情 */
  @Get('tasks/:id')
  getTask(@Param('id') id: string) {
    return this.tasksService.findById(id);
  }

  /** 场景二 #4：提交竞标方案并占席位（席位满 409 CONFLICT_SEAT_FULL）；§21.4 W3 快照字段 */
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
      workspace_name?: unknown;
      workspace_avatar_url?: unknown;
    },
  ) {
    const workspaceId = body.workspace_id;
    if (typeof workspaceId !== 'string' || !workspaceId) {
      throw validationError('workspace_id is required');
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
      // §21.4 W3：投标时点快照（Console 传入；可省略，缺省回退本地投影）
      workspaceName:
        typeof body.workspace_name === 'string' && body.workspace_name
          ? body.workspace_name
          : undefined,
      workspaceAvatarUrl:
        typeof body.workspace_avatar_url === 'string'
          ? body.workspace_avatar_url
          : undefined,
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
      throw validationError('project_id is required');
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
  @Post('orders/:id/cancel-requests/:requestId/respond')
  cancelRespond(
    @Param('id') orderId: string,
    @Param('requestId') requestId: string,
    @Body() body: { response?: unknown },
  ) {
    const response = body.response;
    if (
      response !== 'accept' &&
      response !== 'reject' &&
      response !== 'counter_proposal'
    ) {
      throw validationError('response must be accept/reject/counter_proposal');
    }
    return this.cancelService.respond(orderId, requestId, response);
  }

  /** 场景八 #26：Console 超时自动处理结果 */
  @Post('orders/:id/cancel-requests/:requestId/auto-resolve')
  cancelAutoResolve(
    @Param('id') orderId: string,
    @Param('requestId') requestId: string,
    @Body() body: { outcome?: unknown },
  ) {
    if (
      body.outcome !== 'accept_partial_settlement' &&
      body.outcome !== 'reject_cancel'
    ) {
      throw validationError(
        'outcome must be accept_partial_settlement/reject_cancel',
      );
    }
    return this.cancelService.autoResolve(orderId, requestId, body.outcome);
  }

  /** 场景八 #28：最终确认取消结算 */
  @Post('orders/:id/cancel-requests/:requestId/finalize')
  cancelFinalize(
    @Param('id') orderId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.cancelService.finalize(orderId, requestId);
  }

  /** 场景八 #30：转纠纷 */
  @Post('orders/:id/cancel-requests/:requestId/to-dispute')
  cancelToDispute(
    @Param('id') orderId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.cancelService.toDispute(orderId, requestId);
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
  @Post('orders/:id/revision-negotiation/start')
  startNegotiation(
    @Param('id') orderId: string,
    @Body() body: { reason?: unknown },
  ) {
    return this.negotiationService.start(
      orderId,
      typeof body.reason === 'string' ? body.reason : 'revision_exhausted',
    );
  }

  /** 场景六 #16：4 选项决策（A 追加修订 / B Spec 变更 / C 接受当前 / D 转纠纷） */
  @Post('orders/:id/revision-negotiation/:negotiationId/decide')
  decideNegotiation(
    @Param('id') orderId: string,
    @Param('negotiationId') negotiationId: string,
    @Body() body: { decision?: unknown },
  ) {
    if (
      body.decision !== 'A' &&
      body.decision !== 'B' &&
      body.decision !== 'C' &&
      body.decision !== 'D'
    ) {
      throw validationError('decision must be A/B/C/D');
    }
    return this.negotiationService.decide(orderId, negotiationId, body.decision);
  }

  /** 场景七 #19：Console 判定修订/新增需求 */
  @Post('orders/:id/revision-requests/:requestId/classify')
  classifyRevision(
    @Param('id') orderId: string,
    @Param('requestId') requestId: string,
    @Body() body: { classification?: unknown },
  ) {
    if (
      body.classification !== 'revision' &&
      body.classification !== 'new_requirement'
    ) {
      throw validationError('classification must be revision/new_requirement');
    }
    return this.specChangeService.classify(orderId, requestId, body.classification);
  }

  /** 场景七 #21：变更提案（3 天对方响应计时） */
  @Post('orders/:id/spec-changes')
  proposeSpecChange(
    @Param('id') orderId: string,
    @Body() body: { change_seq?: unknown; payload?: unknown },
  ) {
    const changeSeq =
      typeof body.change_seq === 'number' ? body.change_seq : 1;
    return this.specChangeService.propose(orderId, changeSeq, {
      payload: body.payload ?? null,
    });
  }

  /** 场景七 #22：确认变更（Spec version+1） */
  @Post('orders/:id/spec-changes/:changeId/confirm')
  confirmSpecChange(
    @Param('id') orderId: string,
    @Param('changeId') changeId: string,
  ) {
    return this.specChangeService.confirm(orderId, changeId);
  }

  /** 场景七 #23：拒绝变更 */
  @Post('orders/:id/spec-changes/:changeId/reject')
  rejectSpecChange(
    @Param('id') orderId: string,
    @Param('changeId') changeId: string,
  ) {
    return this.specChangeService.reject(orderId, changeId);
  }

  /** 场景九 #31：触发结算（7 天托管期；平台备数据，划款交关联方） */
  @Post('orders/:id/settlement/trigger')
  triggerSettlement(@Param('id') orderId: string) {
    return this.settlementsService.trigger(orderId);
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
  @Post('orders/:id/disputes/:disputeId/evidence')
  disputeEvidence(
    @Param('id') orderId: string,
    @Param('disputeId') disputeId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.disputesService.submitEvidence(orderId, disputeId, body);
  }

  /** 场景十 #43：确认仲裁结果（终态） */
  @Post('orders/:id/disputes/:disputeId/acknowledge')
  disputeAcknowledge(
    @Param('id') orderId: string,
    @Param('disputeId') disputeId: string,
  ) {
    return this.disputesService.acknowledge(orderId, disputeId);
  }
}

/** 请求参数校验失败：契约要求 400 + VALIDATION_*（RFC 7807 渲染） */
function validationError(message: string): ContractError {
  return new ContractError(
    400,
    CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
    message,
  );
}

type SubmitSpecMilestone = {
  key?: string;
  weight?: number;
  status?: string;
};
