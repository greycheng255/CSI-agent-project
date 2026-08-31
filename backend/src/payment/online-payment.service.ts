import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { WebhooksService } from '../webhooks/webhooks.service';
import { AlipayClientService } from './alipay-client.service';
import {
  Payment,
  PaymentProvider,
  PaymentStatus,
} from './entities/payment.entity';
import {
  PaymentNotification,
  PaymentNotificationSource,
} from './entities/payment-notification.entity';
import {
  OrderPayment,
  OrderPaymentStatus,
  OrderPayoutStatus,
} from './entities/order-payment.entity';

const PAYMENT_TIMEOUT_MINUTES = 15;
const SUCCESS_TRADE_STATUSES = new Set(['TRADE_SUCCESS', 'TRADE_FINISHED']);

export function yuanStringToFen(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [yuan, fraction = ''] = normalized.split('.');
  const fen = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(fen) ? fen : null;
}

type PaymentStatusView = {
  paymentId: string;
  orderId: string;
  outTradeNo: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  orderStatus: OrderStatus;
  amountCny: number;
  paidAt: string | null;
  expiresAt: string;
};

@Injectable()
export class OnlinePaymentService {
  private readonly logger = new Logger(OnlinePaymentService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(PaymentNotification)
    private readonly notificationRepo: Repository<PaymentNotification>,
    private readonly dataSource: DataSource,
    private readonly alipay: AlipayClientService,
    private readonly webhooksService: WebhooksService,
  ) {}

  isAlipayConfigured(): boolean {
    return this.alipay.isConfigured();
  }

  async createAlipayPayment(orderId: string, userId: string) {
    const usePessimisticLock = this.dataSource.options.type !== 'sqlite';
    const { order, payment } = await this.dataSource.transaction(
      async (manager) => {
        const order = await manager.findOne(Order, {
          where: { id: orderId },
          relations: ['task', 'client', 'owner'],
          ...(usePessimisticLock
            ? { lock: { mode: 'pessimistic_write' as const } }
            : {}),
        });
        if (!order) throw new NotFoundException('订单不存在');
        const clientId = order.client?.id || order.clientUserId;
        if (!clientId || clientId !== userId) {
          throw new ForbiddenException('只有订单雇主可以支付或查询支付状态');
        }

        let payment = await manager.findOne(Payment, {
          where: {
            order: { id: orderId },
            provider: PaymentProvider.ALIPAY,
          },
          relations: ['order'],
          order: { createdAt: 'DESC' },
          ...(usePessimisticLock
            ? { lock: { mode: 'pessimistic_write' as const } }
            : {}),
        });
        if (order.status !== OrderStatus.PENDING_PAYMENT) {
          if (payment?.status === PaymentStatus.PAID) {
            return { order, payment };
          }
          throw new BadRequestException('订单当前状态不允许支付');
        }
        if (!Number.isSafeInteger(order.amountCny) || order.amountCny <= 0) {
          throw new BadRequestException('订单金额无效');
        }

        if (payment?.status === PaymentStatus.INIT && this.isExpired(payment)) {
          payment.status = PaymentStatus.FAILED;
          await manager.save(payment);
          payment = null;
        }
        if (!payment || payment.status !== PaymentStatus.INIT) {
          payment = await manager.save(
            manager.create(Payment, {
              order,
              provider: PaymentProvider.ALIPAY,
              outTradeNo: this.createOutTradeNo(),
              tradeNo: null,
              amountCny: order.amountCny,
              status: PaymentStatus.INIT,
              rawNotify: null,
              paidAt: null,
            }),
          );
        }
        return { order, payment };
      },
    );

    if (payment.status === PaymentStatus.PAID) {
      return { ...this.toStatusView(payment, order), paymentUrl: null };
    }

    const paymentUrl = this.alipay.createPagePayment({
      outTradeNo: payment.outTradeNo,
      amountCny: payment.amountCny,
      subject: `CSI 任务订单：${order.task?.title || order.id}`,
      timeoutMinutes: PAYMENT_TIMEOUT_MINUTES,
    });
    return { ...this.toStatusView(payment, order), paymentUrl };
  }

  async getAlipayPaymentStatus(
    orderId: string,
    userId: string,
    refresh = false,
  ): Promise<PaymentStatusView> {
    const order = await this.loadOwnedOrder(orderId, userId);
    let payment = await this.findLatestPayment(orderId);
    if (!payment) throw new NotFoundException('该订单尚未创建在线支付');

    if (payment.status === PaymentStatus.INIT && refresh) {
      await this.refreshFromAlipay(payment.outTradeNo);
      payment = (await this.findLatestPayment(orderId)) || payment;
      const refreshedOrder = await this.orderRepo.findOne({
        where: { id: orderId },
      });
      return this.toStatusView(payment, refreshedOrder || order);
    }
    return this.toStatusView(payment, order);
  }

  async handleAlipayNotification(
    params: Record<string, string>,
    clientIp?: string,
  ): Promise<boolean> {
    const notifyId = params.notify_id?.trim() || null;
    let log = notifyId
      ? await this.notificationRepo.findOne({
          where: { provider: PaymentProvider.ALIPAY, notifyId },
        })
      : null;
    if (log?.processed) return true;

    const signatureValid = this.alipay.verifyNotification(params);
    if (!log) {
      log = await this.notificationRepo.save(
        this.notificationRepo.create({
          provider: PaymentProvider.ALIPAY,
          source: PaymentNotificationSource.CALLBACK,
          notifyId,
          outTradeNo: params.out_trade_no?.trim() || null,
          tradeNo: params.trade_no?.trim() || null,
          signatureValid,
          processed: false,
          failureReason: null,
          rawPayload: params,
          clientIp: clientIp || null,
          processedAt: null,
        }),
      );
    }

    if (!signatureValid) {
      await this.failNotification(log, 'invalid_signature');
      return false;
    }
    if (!SUCCESS_TRADE_STATUSES.has(params.trade_status || '')) {
      log.processed = true;
      log.processedAt = new Date();
      log.failureReason = `ignored_trade_status:${params.trade_status || 'empty'}`;
      await this.notificationRepo.save(log);
      return true;
    }

    try {
      await this.settleSuccessfulPayment({
        logId: log.id,
        outTradeNo: params.out_trade_no || '',
        tradeNo: params.trade_no || '',
        totalAmount: params.total_amount || '',
        appId: params.app_id || '',
        sellerId: params.seller_id || '',
        raw: params,
        requireMerchantIdentity: true,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      await this.failNotification(log, message);
      this.logger.error(
        `支付宝回调处理失败 outTradeNo=${params.out_trade_no || '-'}: ${message}`,
      );
      return false;
    }
  }

  async refreshFromAlipay(outTradeNo: string): Promise<void> {
    const payment = await this.paymentRepo.findOne({
      where: { outTradeNo, provider: PaymentProvider.ALIPAY },
      relations: ['order'],
    });
    if (!payment || payment.status !== PaymentStatus.INIT) return;

    const query = await this.alipay.queryTrade(outTradeNo);
    if (query.status === 'PENDING' || query.status === 'UNKNOWN') return;

    const log = await this.notificationRepo.save(
      this.notificationRepo.create({
        provider: PaymentProvider.ALIPAY,
        source: PaymentNotificationSource.QUERY,
        notifyId: null,
        outTradeNo,
        tradeNo: query.tradeNo,
        signatureValid: true,
        processed: false,
        failureReason: null,
        rawPayload: Object.fromEntries(
          Object.entries(query.raw).map(([key, value]) => [
            key,
            typeof value === 'string' ? value : JSON.stringify(value),
          ]),
        ),
        clientIp: null,
        processedAt: null,
      }),
    );

    if (query.outTradeNo !== outTradeNo) {
      await this.failNotification(log, 'out_trade_no_mismatch');
      throw new Error('out_trade_no_mismatch');
    }

    if (query.status === 'PAID' && query.totalAmount) {
      try {
        await this.settleSuccessfulPayment({
          logId: log.id,
          outTradeNo,
          tradeNo: query.tradeNo || '',
          totalAmount: query.totalAmount,
          appId: this.alipay.appId,
          sellerId: this.alipay.sellerId || '',
          raw: log.rawPayload,
          requireMerchantIdentity: false,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'unknown_error';
        await this.failNotification(log, message);
        throw error;
      }
    } else if (query.status === 'CLOSED') {
      payment.status = PaymentStatus.FAILED;
      await this.paymentRepo.save(payment);
      log.processed = true;
      log.processedAt = new Date();
      log.failureReason = 'trade_closed';
      await this.notificationRepo.save(log);
    }
  }

  async resolveReturnTarget(params: Record<string, string>): Promise<string> {
    const base =
      process.env.PAYMENT_FRONTEND_BASE_URL?.trim() ||
      process.env.FRONTEND_BASE_URL?.trim() ||
      'http://localhost:5173';
    const fallback = new URL('/', base);
    const outTradeNo = params.out_trade_no?.trim();
    if (!outTradeNo || !this.alipay.verifyNotification(params)) {
      fallback.searchParams.set('payment', 'invalid');
      return fallback.toString();
    }
    const payment = await this.paymentRepo.findOne({
      where: { outTradeNo, provider: PaymentProvider.ALIPAY },
      relations: ['order'],
    });
    if (!payment?.order?.id) {
      fallback.searchParams.set('payment', 'unknown');
      return fallback.toString();
    }
    const target = new URL(`/orders/${payment.order.id}/pay`, base);
    target.searchParams.set('payment', 'returned');
    return target.toString();
  }

  private async settleSuccessfulPayment(input: {
    logId: string;
    outTradeNo: string;
    tradeNo: string;
    totalAmount: string;
    appId: string;
    sellerId: string;
    raw: Record<string, string>;
    requireMerchantIdentity: boolean;
  }): Promise<void> {
    if (!input.outTradeNo || !input.tradeNo) {
      throw new Error('missing_trade_identity');
    }
    if (input.requireMerchantIdentity && input.appId !== this.alipay.appId) {
      throw new Error('app_id_mismatch');
    }
    const expectedSellerId = this.alipay.sellerId;
    if (
      input.requireMerchantIdentity &&
      expectedSellerId &&
      input.sellerId !== expectedSellerId
    ) {
      throw new Error('seller_id_mismatch');
    }
    const paidFen = yuanStringToFen(input.totalAmount);
    if (paidFen == null) throw new Error('invalid_total_amount');

    let activatedOrder: Order | null = null;
    const usePessimisticLock = this.dataSource.options.type !== 'sqlite';
    await this.dataSource.transaction(async (manager) => {
      const payment = await manager.findOne(Payment, {
        where: {
          outTradeNo: input.outTradeNo,
          provider: PaymentProvider.ALIPAY,
        },
        relations: ['order'],
        ...(usePessimisticLock
          ? { lock: { mode: 'pessimistic_write' as const } }
          : {}),
      });
      if (!payment) throw new Error('payment_not_found');
      if (payment.amountCny !== paidFen) throw new Error('amount_mismatch');

      const notification = await manager.findOne(PaymentNotification, {
        where: { id: input.logId },
        ...(usePessimisticLock
          ? { lock: { mode: 'pessimistic_write' as const } }
          : {}),
      });
      if (!notification) throw new Error('notification_log_not_found');

      if (payment.status !== PaymentStatus.PAID) {
        payment.status = PaymentStatus.PAID;
        payment.tradeNo = input.tradeNo;
        payment.rawNotify = input.raw;
        payment.paidAt = new Date();
        await manager.save(payment);
      }

      const order = payment.order;
      if (!order) throw new Error('payment_order_not_found');
      let orderPayment = await manager.findOne(OrderPayment, {
        where: { orderId: order.id },
        ...(usePessimisticLock
          ? { lock: { mode: 'pessimistic_write' as const } }
          : {}),
      });
      if (!orderPayment) {
        orderPayment = manager.create(OrderPayment, {
          orderId: order.id,
          platformCodeId: null,
          ownerCodeId: null,
          paymentStatus: OrderPaymentStatus.CONFIRMED,
          payoutStatus: OrderPayoutStatus.PENDING,
          amountCny: order.amountCny,
          platformFeeCny: 0,
          payoutCny: order.amountCny,
          paymentProofUrl: null,
          paidAt: payment.paidAt,
          paymentConfirmedAt: payment.paidAt,
          paymentConfirmedBy: null,
          payoutProofUrl: null,
          payoutAt: null,
          payoutConfirmedAt: null,
          payoutConfirmedBy: null,
          remark: `支付宝交易号: ${input.tradeNo}`,
        });
      } else {
        orderPayment.paymentStatus = OrderPaymentStatus.CONFIRMED;
        orderPayment.paidAt = payment.paidAt;
        orderPayment.paymentConfirmedAt = payment.paidAt;
        orderPayment.amountCny = order.amountCny;
        orderPayment.platformFeeCny = 0;
        orderPayment.payoutCny = order.amountCny;
        orderPayment.remark = `支付宝交易号: ${input.tradeNo}`;
      }
      await manager.save(orderPayment);

      if (
        order.status === OrderStatus.PENDING_PAYMENT ||
        order.status === OrderStatus.CANCELED
      ) {
        order.status = OrderStatus.IN_PROGRESS;
        order.escrowedAt = payment.paidAt;
        order.platformFeeRate = 0;
        order.platformFeeCny = 0;
        order.payoutCny = order.amountCny;
        activatedOrder = await manager.save(order);
      }

      notification.processed = true;
      notification.processedAt = new Date();
      notification.failureReason = null;
      await manager.save(notification);
    });

    if (activatedOrder) {
      void this.webhooksService.notifyOrderPaid(activatedOrder);
    }
  }

  private async loadOwnedOrder(
    orderId: string,
    userId: string,
  ): Promise<Order> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['task', 'client', 'owner'],
    });
    if (!order) throw new NotFoundException('订单不存在');
    const clientId = order.client?.id || order.clientUserId;
    if (!clientId || clientId !== userId) {
      throw new ForbiddenException('只有订单雇主可以支付或查询支付状态');
    }
    return order;
  }

  private findLatestPayment(orderId: string): Promise<Payment | null> {
    return this.paymentRepo.findOne({
      where: {
        order: { id: orderId },
        provider: PaymentProvider.ALIPAY,
      },
      relations: ['order'],
      order: { createdAt: 'DESC' },
    });
  }

  private isExpired(payment: Payment): boolean {
    return (
      payment.createdAt.getTime() + PAYMENT_TIMEOUT_MINUTES * 60_000 <
      Date.now()
    );
  }

  private createOutTradeNo(): string {
    return `CSI${Date.now()}${randomBytes(6).toString('hex')}`;
  }

  private toStatusView(payment: Payment, order: Order): PaymentStatusView {
    return {
      paymentId: payment.id,
      orderId: order.id,
      outTradeNo: payment.outTradeNo,
      status:
        payment.status === PaymentStatus.PAID
          ? 'PAID'
          : payment.status === PaymentStatus.FAILED
            ? 'FAILED'
            : 'PENDING',
      orderStatus: order.status,
      amountCny: payment.amountCny,
      paidAt: payment.paidAt?.toISOString() || null,
      expiresAt: new Date(
        payment.createdAt.getTime() + PAYMENT_TIMEOUT_MINUTES * 60_000,
      ).toISOString(),
    };
  }

  private async failNotification(
    log: PaymentNotification,
    reason: string,
  ): Promise<void> {
    log.processed = false;
    log.failureReason = reason.slice(0, 1000);
    await this.notificationRepo.save(log);
  }
}
