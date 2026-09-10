import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import type { RequestWithUser } from '../../auth/auth.guard';
import { MarketplaceOrdersService } from '../marketplace-orders/marketplace-orders.service';
import { DeliveryContractService } from '../marketplace-orders/delivery-contract.service';
import { MarketplaceTasksService } from '../marketplace-tasks/marketplace-tasks.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { SettlementsService } from '../settlements/settlements.service';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';

/**
 * Agent Owner 接单履约（长任务线，平台前端用）：
 *  - GET  /                   名下工作室的中标订单列表（任务标题/价格/四态/结算款）
 *  - GET  /:id                订单详情（Spec 快照与里程碑、交付物历史、结算单）
 *  - POST /:id/deliverables   Owner 主动提交交付物（等价 Console #13 语义，启动 14 天验收计时）
 */
@Controller('api/v1/longtask/owner/orders')
@UseGuards(AuthGuard)
export class OwnerMarketplaceOrdersController {
  constructor(
    private readonly ordersService: MarketplaceOrdersService,
    private readonly deliveryContractService: DeliveryContractService,
    private readonly tasksService: MarketplaceTasksService,
    private readonly workspacesService: WorkspacesService,
    private readonly settlementsService: SettlementsService,
  ) {}

  /** 登录 Owner 名下工作室（无工作室 → 视为无订单） */
  private async requireMyWorkspace(userId?: string) {
    if (!userId) {
      throw new ContractError(
        403,
        CONTRACT_ERROR_CODE.FORBIDDEN,
        'login required: only the workspace owner can read owner orders',
      );
    }
    return this.workspacesService.findByOwner(userId);
  }

  /** 校验订单属于当前 Owner 名下工作室 */
  private async assertOrderOwnership(orderId: string, userId?: string) {
    const workspace = await this.requireMyWorkspace(userId);
    if (!workspace) {
      throw new ContractError(
        403,
        CONTRACT_ERROR_CODE.FORBIDDEN,
        'workspace not found for current owner',
      );
    }
    const order = await this.ordersService.findById(orderId);
    if (!order || order.workspaceId !== workspace.id) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_ORDER,
        `order not found for your workspace: ${orderId}`,
      );
    }
    return { order, workspace };
  }

  @Get()
  async list(@Req() req: RequestWithUser) {
    const workspace = await this.requireMyWorkspace(req.user?.id);
    if (!workspace) return [];
    const [orders, settlements] = await Promise.all([
      this.ordersService.listByWorkspace(workspace.id),
      this.settlementsService.listByWorkspace(workspace.id),
    ]);
    const settlementByOrder = new Map(
      settlements.map((s) => [s.orderId, s]),
    );
    const tasks = await Promise.all(
      [...new Set(orders.map((o) => o.marketplaceTaskId))].map((id) =>
        this.tasksService.findById(id),
      ),
    );
    const taskTitles = new Map(
      tasks.filter((t) => !!t).map((t) => [t!.id, t!.title]),
    );
    return orders.map((order) => {
      const settlement = settlementByOrder.get(order.id) ?? null;
      return {
        ...order,
        taskTitle: taskTitles.get(order.marketplaceTaskId) ?? null,
        workspaceName: workspace.name,
        settlementStatus: settlement?.status ?? null,
        settlementAmountCny: settlement?.amountCny ?? null,
        settledAt: settlement?.completedAt ?? null,
      };
    });
  }

  @Get(':id')
  async detail(@Param('id') orderId: string, @Req() req: RequestWithUser) {
    const { order, workspace } = await this.assertOrderOwnership(
      orderId,
      req.user?.id,
    );
    const [task, deliveries, settlement] = await Promise.all([
      this.tasksService.findById(order.marketplaceTaskId),
      this.deliveryContractService.listByOrder(orderId),
      this.settlementsService.getByOrder(orderId).catch(() => null),
    ]);
    return {
      order,
      task,
      workspace,
      deliveries,
      settlement,
    };
  }

  /** Owner 提交交付物（平台内履约，等价 Console 侧 #13 提交语义） */
  @Post(':id/deliverables')
  async submitDeliverable(
    @Param('id') orderId: string,
    @Body()
    body: { metadata?: unknown; artifact_urls?: unknown },
    @Req() req: RequestWithUser,
  ) {
    await this.assertOrderOwnership(orderId, req.user?.id);
    if (Array.isArray(body.artifact_urls) && body.artifact_urls.length === 0) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        'artifact_urls must not be empty when provided',
      );
    }
    return this.deliveryContractService.submitDeliverable(orderId, {
      metadata:
        body.metadata && typeof body.metadata === 'object'
          ? (body.metadata as Record<string, unknown>)
          : null,
      artifactUrls: Array.isArray(body.artifact_urls)
        ? (body.artifact_urls as string[])
        : null,
    });
  }
}
