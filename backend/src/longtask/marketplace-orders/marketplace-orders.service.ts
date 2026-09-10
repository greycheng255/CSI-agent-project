import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MarketplaceOrder } from './marketplace-order.entity';
import { MarketplaceCancelRequest } from './cancel-request.entity';
import { BalanceService } from '../../payment/balance.service';
import { BalanceChangeType } from '../../payment/entities/balance.entity';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';

/** project_id 为 uuid 列，非 uuid 输入拒绝为 400（避免 PG 22P02 抛 500） */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 长任务订单服务：bid.won 后 Console 异步回填 project_id（C→M 场景三 #6）。
 * 回填幂等：null→set 生效；同值重复回填视为重试幂等放行；不同值 → 409。
 */
@Injectable()
export class MarketplaceOrdersService {
  private readonly logger = new Logger(MarketplaceOrdersService.name);

  constructor(
    @InjectRepository(MarketplaceOrder)
    private readonly repo: Repository<MarketplaceOrder>,
    @InjectRepository(MarketplaceCancelRequest)
    private readonly cancelRepo: Repository<MarketplaceCancelRequest>,
    private readonly balanceService: BalanceService,
  ) {}

  async applyProjectId(
    orderId: string,
    projectId: string,
  ): Promise<MarketplaceOrder> {
    const order = await this.getOrThrow(orderId);
    if (!projectId) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        'project_id is required',
      );
    }
    if (!UUID_RE.test(projectId)) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        `project_id must be a uuid: ${projectId}`,
      );
    }
    if (order.projectId === null) {
      order.projectId = projectId;
    } else if (order.projectId !== projectId) {
      throw new ContractError(
        409,
        CONTRACT_ERROR_CODE.CONFLICT_DUPLICATE,
        `order already bound to project_id ${order.projectId}`,
      );
    }
    // 与既有值相同 → 重试幂等，直接返回
    return this.repo.save(order);
  }

  findById(id: string): Promise<MarketplaceOrder | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * 认领无主订单（employer_user_id 为空的历史/外部订单）：
   * 由当前登录雇主首次操作时落定归属，保证「验收/确认 Spec/取消/纠纷只能由雇主本人完成」。
   */
  async claimEmployer(
    orderId: string,
    userId: string,
  ): Promise<MarketplaceOrder> {
    const order = await this.getOrThrow(orderId);
    if (order.employerUserId && order.employerUserId !== userId) {
      throw new ContractError(
        403,
        CONTRACT_ERROR_CODE.FORBIDDEN,
        'order already has a different employer',
      );
    }
    if (!order.employerUserId) {
      order.employerUserId = userId;
      return this.repo.save(order);
    }
    return order;
  }

  /** 对账 #38：Workspace 订单列表 */
  listByWorkspace(workspaceId: string): Promise<MarketplaceOrder[]> {
    return this.repo.find({ where: { workspaceId } });
  }

  /** 雇主「我的订单」列表（长任务线，按创建时间倒序） */
  listByEmployer(employerUserId: string): Promise<MarketplaceOrder[]> {
    return this.repo.find({
      where: { employerUserId },
      order: { createdAt: 'DESC' },
    });
  }

  /** 按任务批量查签约订单（「我的长任务」页展示选标结果与入口） */
  listByTaskIds(taskIds: string[]): Promise<MarketplaceOrder[]> {
    if (taskIds.length === 0) return Promise.resolve([]);
    return this.repo.find({ where: { marketplaceTaskId: In(taskIds) } });
  }

  /**
   * 雇主签约托管支付（余额，一次一付）：
   * - 对外金额语义统一为「元」：按订单 final_price_cny（元）计费，前端不传金额；
   * - 仅签约中（contract_status=signing）且未支付可付；
   * - 余额库底层以分记账（与短任务线一致），此处唯一换算点 元×100→分；
   * - 余额扣款独立事务（不足/无账户抛 400）；扣款成功后落订单托管态，失败自动退款补偿。
   */
  async payWithBalance(
    orderId: string,
    userId: string,
  ): Promise<MarketplaceOrder> {
    const order = await this.claimEmployer(orderId, userId);
    if (order.contractStatus !== 'signing') {
      throw new ContractError(
        422,
        CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION,
        `order is not in signing state (status=${order.contractStatus})`,
      );
    }
    if (order.paymentStatus === 'paid') {
      throw new ContractError(
        409,
        CONTRACT_ERROR_CODE.CONFLICT_DUPLICATE,
        'order payment already escrowed',
      );
    }
    const priceCny = order.finalPriceCny ?? 0;
    if (!Number.isInteger(priceCny) || priceCny <= 0) {
      throw new ContractError(
        422,
        CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION,
        'order has no valid final price to pay',
      );
    }
    const amountFen = priceCny * 100; // 余额体系单位为分

    // 1. 余额扣款（独立事务 + 流水，orderId 记长任务订单 id）
    await this.balanceService.payFromBalance({
      userId,
      amountCny: amountFen,
      orderId: order.id,
    });

    // 2. 扣款成功后落托管态；失败退款补偿，保证余额与订单一致
    try {
      order.paymentStatus = 'paid';
      order.paidAt = new Date();
      return await this.repo.save(order);
    } catch (error) {
      await this.balanceService.addIncome({
        userId,
        amountCny: amountFen,
        orderId: order.id,
        changeType: BalanceChangeType.REFUND,
        description: `长任务签约支付失败退款: ${orderId}`,
      });
      this.logger.error(`longtask escrow persist failed, refunded: ${orderId}`);
      throw error;
    }
  }

  /** 订单当前最新一条取消协商请求（雇主详情页展示协商状态） */
  latestCancelRequest(orderId: string) {
    return this.cancelRepo.findOne({
      where: { orderId },
      order: { cancelProposalSeq: 'DESC' },
    });
  }

  /** 对账 #37：订单状态（Console 每 10min 对账调用） */
  async orderStatus(orderId: string) {
    const order = await this.getOrThrow(orderId);
    // cancel_request 扩展键（双方实现约定，§19.1 样例外）：Console 取消协商对账兜底依赖。
    // 无取消请求时键值为 null（键恒出现）。
    const latestCancel = await this.cancelRepo.findOne({
      where: { orderId },
      order: { cancelProposalSeq: 'DESC' },
    });
    return {
      order_id: order.id,
      project_id: order.projectId,
      contract_status: order.contractStatus,
      delivery_status: order.deliveryStatus,
      settlement_status: order.settlementStatus,
      // 扩展键（双方实现约定，§19.1 样例外）：雇主签约托管支付状态（unpaid/paid）
      payment_status: order.paymentStatus ?? 'unpaid',
      cancel_request: latestCancel
        ? {
            cancel_request_id: latestCancel.id,
            cancel_proposal_seq: latestCancel.cancelProposalSeq,
            status: latestCancel.status,
            trigger: latestCancel.trigger,
            owner_response: latestCancel.ownerResponse,
            resolution: latestCancel.resolution,
            created_at: latestCancel.createdAt,
          }
        : null,
    };
  }

  private async getOrThrow(orderId: string): Promise<MarketplaceOrder> {
    const order = await this.repo.findOne({ where: { id: orderId } });
    if (!order) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_ORDER,
        `order not found: ${orderId}`,
      );
    }
    return order;
  }
}