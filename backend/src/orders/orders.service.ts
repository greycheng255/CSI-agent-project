/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Order, OrderStatus } from './entities/order.entity';
import { Delivery, DeliveryStatus } from './entities/delivery.entity';
import { DeliveryRevision, RevisionType } from './entities/delivery-revision.entity';
import { AcceptanceChecklist, ChecklistItemStatus } from './entities/acceptance-checklist.entity';
import {
  Arbitration,
  ArbitrationStatus,
  ArbitrationResolution,
} from '../arbitrations/entities/arbitration.entity';
import { AuditLog, ActorType } from '../audit/entities/audit-log.entity';
import { UserPaymentCode } from '../payment/entities/user-payment-code.entity';
import { WebhooksService } from '../webhooks/webhooks.service';
import { BalanceService } from '../payment/balance.service';
import { ExecutionPhase, ExecutionTrace } from '../execution/entities';

type DeliverDto = {
  deliverySummary?: string;
  deliveryUrl?: string;
  artifactUrls?: string[];
  evidenceBundle?: Record<string, unknown>;
  commitHash?: string;
  previewData?: {
    type: 'code' | 'text' | 'link' | 'image';
    content: string;
    language?: string;
  };
};

type RejectDto = {
  reason?: string;
  requireRevision?: boolean; // 是否要求修改（true=退回修改，false=直接拒绝/仲裁）
};

type ChecklistCheckDto = {
  itemId: string;
  status: ChecklistItemStatus;
  comment?: string;
};

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    @InjectRepository(Delivery)
    private deliveriesRepository: Repository<Delivery>,
    @InjectRepository(DeliveryRevision)
    private deliveryRevisionsRepository: Repository<DeliveryRevision>,
    @InjectRepository(AcceptanceChecklist)
    private acceptanceChecklistRepository: Repository<AcceptanceChecklist>,
    @InjectRepository(Arbitration)
    private arbitrationsRepository: Repository<Arbitration>,
    @InjectRepository(AuditLog)
    private auditLogsRepository: Repository<AuditLog>,
    @InjectRepository(UserPaymentCode)
    private userPaymentCodeRepository: Repository<UserPaymentCode>,
    @InjectRepository(ExecutionPhase)
    private executionPhasesRepository: Repository<ExecutionPhase>,
    @InjectRepository(ExecutionTrace)
    private executionTracesRepository: Repository<ExecutionTrace>,
    private readonly webhooksService: WebhooksService,
    private readonly balanceService: BalanceService,
  ) {}

  private async logOrderStatusChange(params: {
    orderId: string;
    from: OrderStatus;
    to: OrderStatus;
    actorType: ActorType;
    actorId: string | null;
    payload?: Record<string, unknown>;
  }) {
    await this.auditLogsRepository.save(
      this.auditLogsRepository.create({
        actorType: params.actorType,
        actorId: params.actorId,
        action: 'ORDER_STATUS_CHANGED',
        entityType: 'ORDER',
        entityId: params.orderId,
        payload: {
          from: params.from,
          to: params.to,
          ...(params.payload || {}),
        },
      }),
    );
  }

  private async enrichOrdersWithPaymentCodes(orders: Order[]): Promise<any[]> {
    const ownerIds = orders
      .map((o) => o.bid?.agent?.owner?.id)
      .filter((id): id is string => !!id);

    // 按 userId 分组的收款码

    const paymentCodesByUser = new Map<string, any[]>();

    if (ownerIds.length > 0) {
      // 获取所有收款码（不只是默认的）
      const paymentCodes = await this.userPaymentCodeRepository.find({
        where: ownerIds.map((id) => ({ userId: id })),
      });

      // 按 userId 分组
      paymentCodes.forEach((pc) => {
        if (!paymentCodesByUser.has(pc.userId)) {
          paymentCodesByUser.set(pc.userId, []);
        }

        paymentCodesByUser.get(pc.userId)!.push({
          id: pc.id,
          qrCodeUrl: pc.qrCodeUrl,
          type: pc.type.toLowerCase(),
          accountName: pc.accountName,
          isDefault: pc.isDefault,
        });
      });
    }

    // 将 TypeORM 实体转换为普通对象，并附加收款码信息
    return orders.map((order) => {
      const ownerId = order.bid?.agent?.owner?.id;
      const codes = ownerId ? paymentCodesByUser.get(ownerId) : undefined;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const defaultCode = codes?.find((c) => c.isDefault);

      return {
        ...order,
        platformFeeRate: 0,
        platformFeeCny: 0,
        payoutCny: order.amountCny,
        clientUserId: order.clientUserId,
        ownerUserId: order.ownerUserId,
        bid: order.bid
          ? {
              ...order.bid,
              agent: order.bid.agent
                ? {
                    ...order.bid.agent,
                    // 包含 owner 信息（手机号等）
                    owner: order.bid.agent.owner
                      ? {
                          id: order.bid.agent.owner.id,
                          phone: order.bid.agent.owner.phone,
                          displayName: order.bid.agent.owner.displayName,
                        }
                      : undefined,
                    paymentCodes: codes || [],
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    paymentQrUrl: defaultCode?.qrCodeUrl || null,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    paymentQrType: defaultCode?.type || null,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    paymentAccount: defaultCode?.accountName || null,
                  }
                : undefined,
            }
          : undefined,
      };
    });
  }

  private async getExecutionSnapshot(orderId: string) {
    const phases = await this.executionPhasesRepository.find({
      where: { orderId },
      order: { sequence: 'ASC', createdAt: 'ASC' },
    });
    const traces = await this.executionTracesRepository.find({
      where: { orderId },
      order: { createdAt: 'DESC' },
      take: 20,
    });

    const totalWeight = phases.reduce((sum, phase) => sum + (phase.weight || 0), 0);
    const weightedProgress = phases.reduce(
      (sum, phase) => sum + (phase.calculateProgress?.() ?? phase.progress ?? 0) * (phase.weight || 0),
      0,
    );
    const totalProgress = totalWeight > 0
      ? Math.round(weightedProgress / totalWeight)
      : phases.length > 0
        ? Math.round(phases.reduce((sum, phase) => sum + (phase.progress || 0), 0) / phases.length)
        : 0;

    return {
      totalProgress,
      status:
        phases.length === 0
          ? 'NOT_STARTED'
          : phases.some((phase) => phase.status === 'FAILED')
            ? 'FAILED'
            : phases.every((phase) => phase.status === 'COMPLETED')
              ? 'COMPLETED'
              : phases.some((phase) => phase.status === 'RUNNING' || phase.status === 'ASSIGNED')
                ? 'IN_PROGRESS'
                : 'PENDING',
      phases,
      traces,
    };
  }

  private async enrichOrderDetail(order: Order) {
    const [enriched] = await this.enrichOrdersWithPaymentCodes([order]);
    const [execution, deliveryHistory, checklistStats] = await Promise.all([
      this.getExecutionSnapshot(order.id),
      this.getDeliveryHistory(order.id),
      this.getChecklistStats(order.id),
    ]);

    return {
      ...enriched,
      execution,
      executionPhases: execution.phases,
      deliveryHistory,
      checklistStats,
    };
  }

  async findOne(id: string) {
    const order = await this.ordersRepository.findOne({
      where: { id },
      relations: [
        'task',
        'client',
        'owner',
      ],
    });
    if (!order) throw new NotFoundException('Order not found');
    
    // 如果订单有 bid_id，再加载 bid 关系
    if (order.bidId) {
      const orderWithBid = await this.ordersRepository.findOne({
        where: { id },
        relations: [
          'task',
          'bid',
          'bid.agent',
          'bid.agent.owner',
          'client',
          'owner',
        ],
      });
      if (orderWithBid) {
        return this.enrichOrderDetail(orderWithBid);
      }
    }
    
    return this.enrichOrderDetail(order);
  }

  async findAll(status?: OrderStatus) {
    console.log('[DEBUG] findAll called with status:', status);
    const where = status ? { status } : {};
    console.log('[DEBUG] where clause:', where);
    const orders = await this.ordersRepository.find({
      where,
      relations: [
        'task',
        'bid',
        'bid.agent',
        'bid.agent.owner',
        'client',
        'owner',
      ],
      order: { createdAt: 'DESC' },
    });
    console.log('[DEBUG] orders found:', orders.length);
    const result = await this.enrichOrdersWithPaymentCodes(orders);
    console.log('[DEBUG] enriched orders:', result.length);
    return result;
  }

  async findByClient(userId: string) {
    const orders = await this.ordersRepository.find({
      where: { clientUserId: userId },
      relations: [
        'task',
        'bid',
        'bid.agent',
        'bid.agent.owner',
        'client',
        'owner',
      ],
      order: { createdAt: 'DESC' },
    });
    return this.enrichOrdersWithPaymentCodes(orders);
  }

  async findByOwner(userId: string) {
    const orders = await this.ordersRepository.find({
      where: { ownerUserId: userId },
      relations: [
        'task',
        'bid',
        'bid.agent',
        'bid.agent.owner',
        'client',
        'owner',
      ],
      order: { createdAt: 'DESC' },
    });
    return this.enrichOrdersWithPaymentCodes(orders);
  }

  async findByAgent(agentId: string) {
    const orders = await this.ordersRepository.find({
      where: { bid: { agent: { id: agentId } } },
      relations: [
        'task',
        'bid',
        'bid.agent',
        'bid.agent.owner',
        'client',
        'owner',
      ],
      order: { createdAt: 'DESC' },
    });
    return this.enrichOrdersWithPaymentCodes(orders);
  }

  async listDeliveries(orderId: string) {
    return this.deliveriesRepository.find({
      where: { orderId },
      relations: ['owner'],
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async findByTask(taskId: string) {
    const orders = await this.ordersRepository.find({
      where: { task: { id: taskId } },
      relations: ['task', 'bid', 'bid.agent', 'client', 'owner'],
      order: { createdAt: 'DESC' },
    });
    return this.enrichOrdersWithPaymentCodes(orders);
  }

  async pay(id: string, payerUserId: string) {
    const order = await this.ordersRepository.findOne({
      where: { id },
      relations: [
        'task',
        'bid',
        'bid.agent',
        'bid.agent.owner',
        'client',
        'owner',
      ],
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException('Order is not in pending payment status');
    }
    const orderClientId = order.client?.id || order.clientUserId;
    if (!orderClientId) {
      throw new BadRequestException('Order has no client');
    }
    if (orderClientId !== payerUserId) {
      throw new BadRequestException('Only the client can pay for this order');
    }

    // 模拟支付宝/微信扫码支付成功的回调逻辑
    // 资金已进入平台托管账户 (Escrow)
    const from = order.status;
    order.status = OrderStatus.IN_PROGRESS;
    order.escrowedAt = new Date();
    order.platformFeeRate = 0;
    order.platformFeeCny = 0;
    order.payoutCny = order.amountCny;

    const saved = await this.ordersRepository.save(order);

    // [追踪点] 订单已支付（资金托管）
    console.log(
      `[ORDER-FLOW] 订单已支付 | orderId=${saved.id} | amount=${saved.amountCny} | fee=${saved.platformFeeCny} | payout=${saved.payoutCny}`,
    );

    // 重新加载完整关系，确保 webhook 能正确获取 Agent 信息
    const orderWithRelations = await this.ordersRepository.findOne({
      where: { id: saved.id },
      relations: [
        'task',
        'bid',
        'bid.agent',
        'bid.agent.owner',
        'client',
        'owner',
      ],
    });

    if (orderWithRelations) {
      // 触发 Webhook，通知对应的 Agent 开始干活
      void this.webhooksService.notifyOrderPaid(orderWithRelations);
    }

    await this.logOrderStatusChange({
      orderId: saved.id,
      from,
      to: saved.status,
      actorType: ActorType.CLIENT,
      actorId: payerUserId,
    });
    return saved;
  }

  /**
   * 提交交付物（支持多次迭代）
   */
  async deliver(id: string, ownerUserId: string, data: DeliverDto) {
    const order = await this.findOne(id);
    
    // 检查订单状态是否允许交付
    const allowedStatuses = [OrderStatus.IN_PROGRESS, OrderStatus.DELIVERED];
    if (!allowedStatuses.includes(order.status)) {
      throw new BadRequestException('Order is not in progress or delivered');
    }
    
    const orderOwnerId = order.owner?.id || order.ownerUserId;
    if (!orderOwnerId) {
      throw new BadRequestException('Order has no owner');
    }
    if (orderOwnerId !== ownerUserId) {
      throw new BadRequestException('Only the owner can deliver');
    }

    // 检查是否超过最大交付次数
    if (order.deliveryCount >= order.maxDeliveryAttempts) {
      throw new BadRequestException(`Maximum delivery attempts (${order.maxDeliveryAttempts}) reached`);
    }

    // 如果有之前的交付，将其标记为已替代
    if (order.currentDeliveryId) {
      await this.deliveriesRepository.update(
        { id: order.currentDeliveryId },
        { status: DeliveryStatus.SUPERSEDED }
      );
    }

    // 创建新交付
    const version = order.deliveryCount + 1;
    const artifactUrls = Array.from(
      new Set([
        ...(Array.isArray(data.artifactUrls) ? data.artifactUrls : []),
        ...(typeof data.deliveryUrl === 'string' && data.deliveryUrl.trim()
          ? [data.deliveryUrl.trim()]
          : []),
      ].filter((url) => typeof url === 'string' && url.trim().length > 0)),
    );
    const delivery = this.deliveriesRepository.create({
      orderId: order.id,
      ownerUserId: order.ownerUserId,
      version,
      status: DeliveryStatus.PENDING_REVIEW,
      deliveryText: typeof data.deliverySummary === 'string' ? data.deliverySummary : null,
      attachmentUrl: typeof data.deliveryUrl === 'string' ? data.deliveryUrl : null,
      artifactUrls: artifactUrls.length > 0 ? artifactUrls : null,
      evidenceBundle: data.evidenceBundle || null,
      commitHash: typeof data.commitHash === 'string' && data.commitHash.trim()
        ? data.commitHash.trim()
        : null,
      previewData: data.previewData || null,
    });
    await this.deliveriesRepository.save(delivery);

    // 创建交付修订记录
    const revision = this.deliveryRevisionsRepository.create({
      deliveryId: delivery.id,
      type: version === 1 ? RevisionType.SUBMIT : RevisionType.MODIFY,
      version,
      deliveryText: delivery.deliveryText,
      attachmentUrl: delivery.attachmentUrl,
      artifactUrls: delivery.artifactUrls,
      evidenceBundle: delivery.evidenceBundle,
      commitHash: delivery.commitHash,
      comment: version === 1 ? 'Initial delivery' : `Revision ${version}`,
      createdById: ownerUserId,
    });
    await this.deliveryRevisionsRepository.save(revision);

    // 更新订单状态
    const from = order.status;
    order.status = OrderStatus.DELIVERED;
    order.deliveredAt = new Date();
    order.deliverySummary = delivery.deliveryText;
    order.deliveryUrl = delivery.attachmentUrl;
    order.currentDeliveryId = delivery.id;
    order.deliveryCount = version;
    const saved = await this.ordersRepository.save(order);

    // [追踪点] 订单已交付
    console.log(
      `[ORDER-FLOW] 订单已交付 | orderId=${saved.id} | version=${version} | ownerId=${ownerUserId} | deliveryUrl=${saved.deliveryUrl}`,
    );

    await this.logOrderStatusChange({
      orderId: saved.id,
      from,
      to: saved.status,
      actorType: ActorType.OWNER,
      actorId: ownerUserId,
      payload: {
        deliveryId: delivery.id,
        version,
        artifactUrls: delivery.artifactUrls,
        commitHash: delivery.commitHash,
      },
    });

    // 触发 Webhook 通知雇主
    void this.webhooksService.notifyDeliverySubmitted(saved, delivery);

    return { order: saved, delivery };
  }

  /**
   * 获取订单的所有交付历史
   */
  async getDeliveryHistory(orderId: string) {
    const deliveries = await this.deliveriesRepository.find({
      where: { orderId },
      relations: ['revisions'],
      order: { version: 'DESC' },
    });
    return deliveries;
  }

  async accept(id: string, clientUserId: string) {
    const order = await this.findOne(id);
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException('Order is not delivered');
    }
    const orderClientId = order.client?.id || order.clientUserId;
    if (!orderClientId) {
      throw new BadRequestException('Order has no client');
    }
    if (orderClientId !== clientUserId) {
      throw new BadRequestException('Only the client can accept');
    }

    let checklist = await this.getChecklist(id);
    if (checklist.length === 0 && order.task?.acceptanceCriteria) {
      checklist = await this.generateChecklistFromTask(id);
    }
    const blockingItems = checklist.filter(
      (item) =>
        item.status === ChecklistItemStatus.PENDING ||
        item.status === ChecklistItemStatus.FAILED,
    );
    if (blockingItems.length > 0) {
      throw new BadRequestException(
        'Acceptance checklist must be fully passed before accepting delivery',
      );
    }

    const from = order.status;
    order.status = OrderStatus.PENDING_RELEASE; // 验收后变为待放款状态
    order.acceptedAt = new Date();
    const accepted = await this.ordersRepository.save(order);

    if (order.currentDeliveryId) {
      await this.deliveriesRepository.update(
        { id: order.currentDeliveryId },
        { status: DeliveryStatus.ACCEPTED, acceptedAt: accepted.acceptedAt },
      );
    }

    // [追踪点] 订单已验收
    console.log(
      `[ORDER-FLOW] 订单已验收 | orderId=${accepted.id} | clientId=${clientUserId} | amount=${accepted.amountCny}`,
    );

    // 触发 Webhook，通知 Agent 订单已验收，等待平台放款
    void this.webhooksService.notifyOrderAccepted(accepted);

    await this.logOrderStatusChange({
      orderId: accepted.id,
      from,
      to: accepted.status,
      actorType: ActorType.CLIENT,
      actorId: clientUserId,
      payload: {
        checklistTotal: checklist.length,
        checklistPassed: checklist.filter((item) => item.status === ChecklistItemStatus.PASSED).length,
        checklistNa: checklist.filter((item) => item.status === ChecklistItemStatus.NA).length,
      },
    });

    return accepted;
  }

  /**
   * 平台放款给开发者
   */
  async release(
    id: string,
    adminUserId: string,
    data: { transactionId?: string; notes?: string },
  ) {
    const order = await this.findOne(id);
    if (order.status !== OrderStatus.PENDING_RELEASE) {
      throw new BadRequestException('Order is not pending release');
    }

    const ownerId = order.bid?.agent?.owner?.id || order.ownerUserId;
    order.platformFeeRate = 0;
    order.platformFeeCny = 0;
    order.payoutCny = order.amountCny;
    const payoutCny = Number(order.amountCny);
    const platformFeeCny = 0;
    if (!ownerId) {
      throw new BadRequestException('Order has no payable owner');
    }
    if (!Number.isFinite(payoutCny) || payoutCny <= 0) {
      throw new BadRequestException('Order payout amount must be greater than 0');
    }

    await this.auditLogsRepository.save(
      this.auditLogsRepository.create({
        entityType: 'ORDER',
        entityId: id,
        action: 'FUNDS_RELEASE_APPROVED',
        actorType: ActorType.ADMIN,
        actorId: adminUserId,
        payload: {
          transactionId: data.transactionId,
          notes: data.notes,
          payoutAmount: payoutCny,
          platformFee: platformFeeCny,
          approvedAt: new Date().toISOString(),
        },
      }),
    );

    const from = order.status;
    order.status = OrderStatus.COMPLETED;
    order.releasedAt = new Date();
    const completed = await this.ordersRepository.save(order);

    // [追踪点] 订单已完成（放款）
    console.log(
      `[ORDER-FLOW] 订单已完成 | orderId=${completed.id} | payout=${completed.payoutCny} | adminId=${adminUserId}`,
    );

    // 给开发者增加余额（订单收入）
    if (payoutCny > 0) {
      try {
        await this.balanceService.addIncome({
          userId: ownerId,
          amountCny: payoutCny,
          orderId: completed.id,
          description: `订单收入: ${payoutCny}元`,
        });
        console.log(
          `[BALANCE] 开发者余额增加 | userId=${ownerId} | amount=${payoutCny}`,
        );
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        console.error(
          `[BALANCE] 增加余额失败 | userId=${ownerId} | error=${errorMessage}`,
        );
      }
    }

    // 扣除平台服务费（从开发者余额中扣除）
    if (ownerId && platformFeeCny > 0) {
      try {
        await this.balanceService.deductPlatformFee({
          userId: ownerId,
          amountCny: platformFeeCny,
          orderId: completed.id,
          description: `平台服务费: ${platformFeeCny}元`,
        });
        console.log(
          `[BALANCE] 平台服务费扣除 | userId=${ownerId} | amount=${platformFeeCny}`,
        );
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        console.error(
          `[BALANCE] 扣除服务费失败 | userId=${ownerId} | error=${errorMessage}`,
        );
      }
    }

    // 记录放款日志
    await this.auditLogsRepository.save(
      this.auditLogsRepository.create({
        entityType: 'Order',
        entityId: id,
        action: 'FUNDS_RELEASED',
        actorType: ActorType.ADMIN,
        actorId: adminUserId,
        payload: {
          transactionId: data.transactionId,
          notes: data.notes,
          payoutAmount: order.payoutCny,
          platformFee: order.platformFeeCny,
        },
      }),
    );

    // 触发 Webhook，通知 Agent 资金已释放
    void this.webhooksService.notifyOrderCompleted(completed);

    await this.logOrderStatusChange({
      orderId: completed.id,
      from,
      to: completed.status,
      actorType: ActorType.ADMIN,
      actorId: adminUserId,
    });

    return completed;
  }

  /**
   * 拒绝交付（支持退回修改或直接拒绝）
   */
  async reject(id: string, clientUserId: string, data: RejectDto) {
    const order = await this.findOne(id);
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException('Order is not delivered');
    }
    const orderClientId = order.client?.id || order.clientUserId;
    if (!orderClientId) {
      throw new BadRequestException('Order has no client');
    }
    if (orderClientId !== clientUserId) {
      throw new BadRequestException('Only the client can reject');
    }

    // 更新当前交付状态
    if (order.currentDeliveryId) {
      await this.deliveriesRepository.update(
        { id: order.currentDeliveryId },
        { 
          status: DeliveryStatus.REJECTED,
          rejectionReason: data.reason || null,
          rejectedAt: new Date(),
        }
      );

      // 创建拒绝修订记录
      const revision = this.deliveryRevisionsRepository.create({
        deliveryId: order.currentDeliveryId,
        type: RevisionType.REJECT,
        version: order.deliveryCount,
        comment: data.reason || 'Delivery rejected',
        createdById: clientUserId,
      });
      await this.deliveryRevisionsRepository.save(revision);
    }

    const from = order.status;
    
    // 如果要求修改，退回给 Agent 继续工作
    if (data.requireRevision !== false) {
      order.status = OrderStatus.IN_PROGRESS;
      order.disputeReason = data.reason ? String(data.reason) : null;
      const saved = await this.ordersRepository.save(order);

      // [追踪点] 交付被退回修改
      console.log(
        `[ORDER-FLOW] 交付被退回修改 | orderId=${saved.id} | version=${order.deliveryCount} | reason=${data.reason}`,
      );

      // 触发 Webhook，通知 Agent 需要修改
      void this.webhooksService.notifyOrderRejected(saved, data.reason);

      await this.logOrderStatusChange({
        orderId: saved.id,
        from,
        to: saved.status,
        actorType: ActorType.CLIENT,
        actorId: clientUserId,
        payload: { 
          reason: data.reason,
          action: 'require_revision',
          deliveryVersion: order.deliveryCount,
        },
      });

      return { order: saved, action: 'require_revision' };
    }

    // 直接拒绝，进入仲裁流程
    order.status = OrderStatus.REJECTED;
    order.disputeReason = data.reason ? String(data.reason) : null;
    const saved = await this.ordersRepository.save(order);

    // 触发 Webhook，通知 Agent 订单被拒绝
    void this.webhooksService.notifyOrderRejected(saved, data.reason);

    await this.arbitrationsRepository.save(
      this.arbitrationsRepository.create({
        order: saved,
        reason: saved.disputeReason,
        status: ArbitrationStatus.OPEN,
        resolution: null,
        resolvedAt: null,
        resolvedByAdminId: null,
      }),
    );
    await this.logOrderStatusChange({
      orderId: saved.id,
      from,
      to: saved.status,
      actorType: ActorType.CLIENT,
      actorId: clientUserId,
    });
    return saved;
  }

  async cancel(id: string, clientUserId: string) {
    const order = await this.findOne(id);
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        'Only pending payment orders can be canceled',
      );
    }
    const orderClientId = order.client?.id || order.clientUserId;
    if (!orderClientId) throw new BadRequestException('Order has no client');
    if (orderClientId !== clientUserId) {
      throw new BadRequestException('Only the client can cancel');
    }
    const from = order.status;
    order.status = OrderStatus.CANCELED;
    order.canceledAt = new Date();
    const saved = await this.ordersRepository.save(order);
    await this.logOrderStatusChange({
      orderId: saved.id,
      from,
      to: saved.status,
      actorType: ActorType.CLIENT,
      actorId: clientUserId,
    });
    return saved;
  }

  async startArbitration(orderId: string, adminUserId: string) {
    const order = await this.findOne(orderId);
    if (order.status !== OrderStatus.REJECTED) {
      throw new BadRequestException('Order is not rejected');
    }
    const arbitration = await this.arbitrationsRepository.findOne({
      where: { order: { id: orderId } },
      relations: ['order'],
      order: { createdAt: 'DESC' },
    });
    if (!arbitration) throw new NotFoundException('Arbitration not found');
    arbitration.status = ArbitrationStatus.IN_PROGRESS;
    arbitration.resolvedByAdminId = adminUserId;
    await this.arbitrationsRepository.save(arbitration);

    const from = order.status;
    order.status = OrderStatus.ARBITRATING;
    const saved = await this.ordersRepository.save(order);
    await this.logOrderStatusChange({
      orderId: saved.id,
      from,
      to: saved.status,
      actorType: ActorType.ADMIN,
      actorId: adminUserId,
      payload: { arbitrationId: arbitration.id },
    });
    return { order: saved, arbitration };
  }

  async resolveArbitration(params: {
    orderId: string;
    adminUserId: string;
    resolution: ArbitrationResolution;
  }) {
    const order = await this.findOne(params.orderId);
    if (order.status !== OrderStatus.ARBITRATING) {
      throw new BadRequestException('Order is not in arbitrating status');
    }
    const arbitration = await this.arbitrationsRepository.findOne({
      where: { order: { id: params.orderId } },
      relations: ['order'],
      order: { createdAt: 'DESC' },
    });
    if (!arbitration) throw new NotFoundException('Arbitration not found');

    arbitration.status = ArbitrationStatus.RESOLVED;
    arbitration.resolution = params.resolution;
    arbitration.resolvedByAdminId = params.adminUserId;
    arbitration.resolvedAt = new Date();
    await this.arbitrationsRepository.save(arbitration);

    const from = order.status;
    if (params.resolution === ArbitrationResolution.REFUND) {
      order.status = OrderStatus.REFUNDED;
      order.refundedAt = new Date();
    } else {
      order.status = OrderStatus.COMPLETED;
      order.releasedAt = new Date();
    }
    const saved = await this.ordersRepository.save(order);
    await this.logOrderStatusChange({
      orderId: saved.id,
      from,
      to: saved.status,
      actorType: ActorType.ADMIN,
      actorId: params.adminUserId,
      payload: { arbitrationId: arbitration.id, resolution: params.resolution },
    });
    return { order: saved, arbitration };
  }

  async uploadPaymentProof(
    orderId: string,
    file: Express.Multer.File,
    platformCodeId?: string,
  ) {
    // 验证订单存在
    const order = await this.findOne(orderId);
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException('Order is not pending payment');
    }

    // 确保目录存在
    const uploadDir = '/data/uploads/payment-proofs';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // 生成文件名
    const timestamp = Date.now();
    const ext = path.extname(file.originalname) || '.jpg';
    const filename = `order-${orderId}-${timestamp}${ext}`;
    const filepath = path.join(uploadDir, filename);

    // 保存文件
    fs.writeFileSync(filepath, file.buffer);

    // 记录审计日志
    await this.auditLogsRepository.save(
      this.auditLogsRepository.create({
        entityType: 'Order',
        entityId: orderId,
        action: 'PAYMENT_PROOF_UPLOADED',
        actorType: ActorType.CLIENT,
        actorId: order.client?.id || null,
        payload: {
          platformCodeId,
          filename,
          originalName: file.originalname,
          size: file.size,
        },
      }),
    );

    return {
      message: 'Payment proof uploaded successfully',
      filename,
      orderId,
    };
  }

  // ==================== 验收检查清单功能 ====================

  /**
   * 从任务验收标准生成检查清单
   */
  async generateChecklistFromTask(orderId: string): Promise<AcceptanceChecklist[]> {
    const order = await this.findOne(orderId);
    const acceptanceCriteria = order.task?.acceptanceCriteria;
    
    if (!acceptanceCriteria) {
      return [];
    }

    // 解析验收标准（假设每行是一个检查项）
    const criteriaLines = acceptanceCriteria
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0);

    const checklistItems: AcceptanceChecklist[] = [];
    
    for (let i = 0; i < criteriaLines.length; i++) {
      const item = this.acceptanceChecklistRepository.create({
        orderId: order.id,
        itemIndex: i,
        criterion: criteriaLines[i],
        status: ChecklistItemStatus.PENDING,
        sortOrder: i,
      });
      checklistItems.push(await this.acceptanceChecklistRepository.save(item));
    }

    return checklistItems;
  }

  /**
   * 获取订单的检查清单
   */
  async getChecklist(orderId: string): Promise<AcceptanceChecklist[]> {
    return this.acceptanceChecklistRepository.find({
      where: { orderId },
      order: { itemIndex: 'ASC' },
    });
  }

  /**
   * 更新检查项状态
   */
  async updateChecklistItem(
    orderId: string,
    clientUserId: string,
    data: ChecklistCheckDto,
  ): Promise<AcceptanceChecklist> {
    const order = await this.findOne(orderId);
    
    // 验证权限
    const orderClientId = order.client?.id || order.clientUserId;
    if (orderClientId !== clientUserId) {
      throw new BadRequestException('Only the client can update checklist');
    }

    // 只能在交付后验收前更新
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException('Can only update checklist when order is delivered');
    }

    const item = await this.acceptanceChecklistRepository.findOne({
      where: { id: data.itemId, orderId },
    });

    if (!item) {
      throw new NotFoundException('Checklist item not found');
    }

    item.status = data.status;
    item.comment = data.comment || null;
    item.checkedById = clientUserId;
    item.checkedAt = new Date();

    return this.acceptanceChecklistRepository.save(item);
  }

  /**
   * 批量更新检查清单
   */
  async updateChecklistBatch(
    orderId: string,
    clientUserId: string,
    items: ChecklistCheckDto[],
  ): Promise<AcceptanceChecklist[]> {
    const results: AcceptanceChecklist[] = [];
    for (const item of items) {
      results.push(await this.updateChecklistItem(orderId, clientUserId, item));
    }
    return results;
  }

  /**
   * 获取检查清单统计
   */
  async getChecklistStats(orderId: string): Promise<{
    total: number;
    passed: number;
    failed: number;
    pending: number;
    na: number;
    passRate: number;
  }> {
    const items = await this.getChecklist(orderId);
    
    const stats = {
      total: items.length,
      passed: items.filter(i => i.status === ChecklistItemStatus.PASSED).length,
      failed: items.filter(i => i.status === ChecklistItemStatus.FAILED).length,
      pending: items.filter(i => i.status === ChecklistItemStatus.PENDING).length,
      na: items.filter(i => i.status === ChecklistItemStatus.NA).length,
      passRate: 0,
    };

    if (stats.total > 0) {
      const checkableItems = stats.total - stats.na;
      if (checkableItems > 0) {
        stats.passRate = Math.round((stats.passed / checkableItems) * 100);
      }
    }

    return stats;
  }
}
