import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketplaceOrder } from './marketplace-order.entity';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';

/**
 * 长任务订单服务：bid.won 后 Console 异步回填 project_id（C→M 场景三 #6）。
 * 回填幂等：null→set 生效；同值重复回填视为重试幂等放行；不同值 → 409。
 */
@Injectable()
export class MarketplaceOrdersService {
  constructor(
    @InjectRepository(MarketplaceOrder)
    private readonly repo: Repository<MarketplaceOrder>,
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

  /** 对账 #38：Workspace 订单列表 */
  listByWorkspace(workspaceId: string): Promise<MarketplaceOrder[]> {
    return this.repo.find({ where: { workspaceId } });
  }

  /** 对账 #37：订单状态（Console 每 10min 对账调用） */
  async orderStatus(orderId: string) {
    const order = await this.getOrThrow(orderId);
    return {
      order_id: order.id,
      project_id: order.projectId,
      contract_status: order.contractStatus,
      delivery_status: order.deliveryStatus,
      settlement_status: order.settlementStatus,
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