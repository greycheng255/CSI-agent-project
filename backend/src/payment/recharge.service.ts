import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { AlipayClientService } from './alipay-client.service';
import { BalanceService } from './balance.service';
import {
  PaymentNotification,
  PaymentNotificationSource,
} from './entities/payment-notification.entity';
import { PaymentProvider } from './entities/payment.entity';
import {
  RechargeOrder,
  RechargeStatus,
} from './entities/recharge.entity';
import { BalanceChangeType } from './entities/balance.entity';
import { yuanStringToFen } from './online-payment.service';

const RECHARGE_TIMEOUT_MINUTES = 15;
/** 单笔充值限额：1 元 ~ 50000 元（分） */
const MIN_RECHARGE_FEN = 100;
const MAX_RECHARGE_FEN = 5_000_000;

export type RechargeStatusView = {
  rechargeId: string;
  outTradeNo: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  amountCny: number;
  paidAt: string | null;
  expiresAt: string;
};

@Injectable()
export class RechargeService {
  private readonly logger = new Logger(RechargeService.name);

  constructor(
    @InjectRepository(RechargeOrder)
    private readonly rechargeRepo: Repository<RechargeOrder>,
    @InjectRepository(PaymentNotification)
    private readonly notificationRepo: Repository<PaymentNotification>,
    private readonly dataSource: DataSource,
    private readonly alipay: AlipayClientService,
    private readonly balanceService: BalanceService,
  ) {}

  /** 创建（或复用未过期的同金额待付单）充值单，返回支付宝收银台跳转 URL */
  async createRecharge(
    userId: string,
    amountCny: number,
  ): Promise<RechargeStatusView & { paymentUrl: string | null }> {
    if (!Number.isSafeInteger(amountCny) || amountCny < MIN_RECHARGE_FEN) {
      throw new BadRequestException('充值金额最低 1 元');
    }
    if (amountCny > MAX_RECHARGE_FEN) {
      throw new BadRequestException('单笔充值不可超过 50000 元');
    }
    if (!this.alipay.isConfigured()) {
      throw new ServiceUnavailableException('支付宝在线支付尚未配置');
    }

    // 复用 15 分钟内未支付的同金额待付单，避免堆积
    let recharge = await this.rechargeRepo.findOne({
      where: { userId, amountCny, status: RechargeStatus.INIT },
      order: { createdAt: 'DESC' },
    });
    if (recharge && this.isExpired(recharge)) {
      recharge.status = RechargeStatus.FAILED;
      await this.rechargeRepo.save(recharge);
      recharge = null;
    }

    if (!recharge) {
      recharge = await this.rechargeRepo.save(
        this.rechargeRepo.create({
          userId,
          outTradeNo: `RCH${Date.now()}${randomBytes(6).toString('hex')}`,
          tradeNo: null,
          amountCny,
          status: RechargeStatus.INIT,
          rawNotify: null,
          paidAt: null,
        }),
      );
    }

    const paymentUrl = this.alipay.createPagePayment({
      outTradeNo: recharge.outTradeNo,
      amountCny: recharge.amountCny,
      subject: 'CSI 平台余额充值',
      timeoutMinutes: RECHARGE_TIMEOUT_MINUTES,
    });
    return { ...this.toStatusView(recharge), paymentUrl };
  }

  /** 查询充值状态；refresh=true 时主动向支付宝查单收敛（回跳轮询用） */
  async getRechargeStatus(
    rechargeId: string,
    userId: string,
    refresh = false,
  ): Promise<RechargeStatusView> {
    const recharge = await this.rechargeRepo.findOne({
      where: { id: rechargeId },
    });
    if (!recharge) throw new NotFoundException('充值单不存在');
    if (recharge.userId !== userId) {
      throw new ForbiddenException('只能查询自己的充值单');
    }

    if (recharge.status === RechargeStatus.INIT) {
      if (refresh) {
        await this.refreshFromAlipay(recharge.outTradeNo);
        const fresh =
          (await this.rechargeRepo.findOne({
            where: { id: rechargeId },
          })) || recharge;
        return this.toStatusView(fresh);
      }
      if (this.isExpired(recharge)) {
        recharge.status = RechargeStatus.FAILED;
        await this.rechargeRepo.save(recharge);
      }
    }
    return this.toStatusView(recharge);
  }

  /** 支付宝异步回调结算入口（notify 验签已通过、trade_status 已确认成功） */
  async settleRecharge(input: {
    outTradeNo: string;
    tradeNo: string;
    totalAmount: string;
    raw: Record<string, string>;
  }): Promise<void> {
    if (!input.outTradeNo || !input.tradeNo) {
      throw new Error('missing_trade_identity');
    }
    const paidFen = yuanStringToFen(input.totalAmount);
    if (paidFen == null) throw new Error('invalid_total_amount');

    const usePessimisticLock = this.dataSource.options.type !== 'sqlite';
    let rechargedUserId: string | null = null;
    await this.dataSource.transaction(async (manager) => {
      const recharge = await manager.findOne(RechargeOrder, {
        where: { outTradeNo: input.outTradeNo },
        ...(usePessimisticLock
          ? { lock: { mode: 'pessimistic_write' as const } }
          : {}),
      });
      if (!recharge) throw new Error('recharge_not_found');
      if (recharge.amountCny !== paidFen) throw new Error('amount_mismatch');
      // 幂等：重复回调直接返回
      if (recharge.status === RechargeStatus.PAID) return;

      recharge.status = RechargeStatus.PAID;
      recharge.tradeNo = input.tradeNo;
      recharge.rawNotify = input.raw;
      recharge.paidAt = new Date();
      await manager.save(recharge);
      rechargedUserId = recharge.userId;
    });

    if (rechargedUserId) {
      // 入账独立于结算事务（addIncome 自带事务与流水）
      await this.balanceService.addIncome({
        userId: rechargedUserId,
        amountCny: paidFen,
        orderId: input.outTradeNo,
        changeType: BalanceChangeType.DEPOSIT,
        description: `余额充值: ¥${(paidFen / 100).toFixed(2)}`,
      });
      this.logger.log(
        `充值入账 | user=${rechargedUserId} outTradeNo=${input.outTradeNo} amount=${paidFen}分`,
      );
    }
  }

  /** 主动查单收敛（回跳后轮询触发） */
  async refreshFromAlipay(outTradeNo: string): Promise<void> {
    const recharge = await this.rechargeRepo.findOne({
      where: { outTradeNo },
    });
    if (!recharge || recharge.status !== RechargeStatus.INIT) return;

    const query = await this.alipay.queryTrade(outTradeNo);
    if (query.status === 'PENDING' || query.status === 'UNKNOWN') return;

    if (query.status === 'PAID') {
      // 查单入账也走 notify 日志（source=QUERY），保证台账完整
      const log = await this.notificationRepo.save(
        this.notificationRepo.create({
          provider: PaymentProvider.ALIPAY,
          source: PaymentNotificationSource.QUERY,
          notifyId: null,
          outTradeNo,
          tradeNo: query.tradeNo,
          signatureValid: true,
          processed: true,
          failureReason: null,
          rawPayload: Object.fromEntries(
            Object.entries(query.raw).map(([key, value]) => [
              key,
              typeof value === 'string' ? value : JSON.stringify(value),
            ]),
          ),
          clientIp: null,
          processedAt: new Date(),
        }),
      );
      log.processed = true;
      await this.notificationRepo.save(log);
      await this.settleRecharge({
        outTradeNo,
        tradeNo: query.tradeNo || '',
        totalAmount: query.totalAmount || (recharge.amountCny / 100).toFixed(2),
        raw: log.rawPayload as Record<string, string>,
      });
    } else if (query.status === 'CLOSED') {
      recharge.status = RechargeStatus.FAILED;
      await this.rechargeRepo.save(recharge);
    }
  }

  /** 按 outTradeNo 查充值单（回跳定位用） */
  async findByOutTradeNo(outTradeNo: string): Promise<RechargeOrder | null> {
    return this.rechargeRepo.findOne({ where: { outTradeNo } });
  }

  /** 我的充值记录（时间倒序） */
  async getMyRecharges(userId: string, limit = 20): Promise<RechargeOrder[]> {
    return this.rechargeRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  private isExpired(recharge: RechargeOrder): boolean {
    return (
      recharge.createdAt.getTime() + RECHARGE_TIMEOUT_MINUTES * 60_000 <
      Date.now()
    );
  }

  private toStatusView(recharge: RechargeOrder): RechargeStatusView {
    return {
      rechargeId: recharge.id,
      outTradeNo: recharge.outTradeNo,
      status:
        recharge.status === RechargeStatus.PAID
          ? 'PAID'
          : recharge.status === RechargeStatus.FAILED
            ? 'FAILED'
            : 'PENDING',
      amountCny: recharge.amountCny,
      paidAt: recharge.paidAt?.toISOString() || null,
      expiresAt: new Date(
        recharge.createdAt.getTime() + RECHARGE_TIMEOUT_MINUTES * 60_000,
      ).toISOString(),
    };
  }
}
