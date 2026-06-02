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
import { Delivery } from './entities/delivery.entity';
import {
  Arbitration,
  ArbitrationStatus,
  ArbitrationResolution,
} from '../arbitrations/entities/arbitration.entity';
import { AuditLog, ActorType } from '../audit/entities/audit-log.entity';
import { UserPaymentCode } from '../payment/entities/user-payment-code.entity';
import { WebhooksService } from '../webhooks/webhooks.service';
import { BalanceService } from '../payment/balance.service';

type DeliverDto = {
  deliverySummary?: string;
  deliveryUrl?: string;
};

type RejectDto = {
  reason?: string;
};

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    @InjectRepository(Delivery)
    private deliveriesRepository: Repository<Delivery>,
    @InjectRepository(Arbitration)
    private arbitrationsRepository: Repository<Arbitration>,
    @InjectRepository(AuditLog)
    private auditLogsRepository: Repository<AuditLog>,
    @InjectRepository(UserPaymentCode)
    private userPaymentCodeRepository: Repository<UserPaymentCode>,
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

  async findOne(id: string) {
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
    await this.enrichOrdersWithPaymentCodes([order]);
    return order;
  }

  async findAll(status?: OrderStatus) {
    const where = status ? { status } : {};
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
    return this.enrichOrdersWithPaymentCodes(orders);
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
      where: { order: { id: orderId } },
      relations: ['owner'],
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async findByTask(taskId: string) {
    return this.ordersRepository.find({
      where: { task: { id: taskId } },
      relations: ['task', 'bid', 'bid.agent', 'client', 'owner'],
      order: { createdAt: 'DESC' },
    });
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
    const fee = Math.round(
      order.amountCny * Number(order.platformFeeRate || 0),
    );
    order.platformFeeCny = Math.max(0, Math.min(order.amountCny, fee));
    order.payoutCny = Math.max(
      0,
      order.amountCny - (order.platformFeeCny || 0),
    );

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

  async deliver(id: string, ownerUserId: string, data: DeliverDto) {
    const order = await this.findOne(id);
    if (order.status !== OrderStatus.IN_PROGRESS) {
      throw new BadRequestException('Order is not in progress');
    }
    const orderOwnerId = order.owner?.id || order.ownerUserId;
    if (!orderOwnerId) {
      throw new BadRequestException('Order has no owner');
    }
    if (orderOwnerId !== ownerUserId) {
      throw new BadRequestException('Only the owner can deliver');
    }
    const delivery = this.deliveriesRepository.create({
      order,
      owner: order.owner,
      deliveryText:
        typeof data.deliverySummary === 'string' ? data.deliverySummary : null,
      attachmentUrl:
        typeof data.deliveryUrl === 'string' ? data.deliveryUrl : null,
    });
    await this.deliveriesRepository.save(delivery);

    const from = order.status;
    order.status = OrderStatus.DELIVERED;
    order.deliveredAt = new Date();
    order.deliverySummary = delivery.deliveryText;
    order.deliveryUrl = delivery.attachmentUrl;
    const saved = await this.ordersRepository.save(order);

    // [追踪点] 订单已交付
    console.log(
      `[ORDER-FLOW] 订单已交付 | orderId=${saved.id} | ownerId=${ownerUserId} | deliveryUrl=${saved.deliveryUrl}`,
    );

    await this.logOrderStatusChange({
      orderId: saved.id,
      from,
      to: saved.status,
      actorType: ActorType.OWNER,
      actorId: ownerUserId,
      payload: { deliveryId: delivery.id },
    });
    return saved;
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
    const from = order.status;
    order.status = OrderStatus.PENDING_RELEASE; // 验收后变为待放款状态
    order.acceptedAt = new Date();
    const accepted = await this.ordersRepository.save(order);

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

    const from = order.status;
    order.status = OrderStatus.COMPLETED;
    order.releasedAt = new Date();
    const completed = await this.ordersRepository.save(order);

    // [追踪点] 订单已完成（放款）
    console.log(
      `[ORDER-FLOW] 订单已完成 | orderId=${completed.id} | payout=${completed.payoutCny} | adminId=${adminUserId}`,
    );

    // 给开发者增加余额（订单收入）
    const ownerId = order.bid?.agent?.owner?.id;
    const payoutCny = completed.payoutCny ?? 0;
    const platformFeeCny = completed.platformFeeCny ?? 0;

    if (ownerId && payoutCny > 0) {
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
    const from = order.status;
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
}
