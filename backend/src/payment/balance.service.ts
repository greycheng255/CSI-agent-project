import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { AlipayClientService } from './alipay-client.service';
import {
  UserBalance,
  BalanceRecord,
  BalanceChangeType,
  Withdrawal,
  WithdrawalStatus,
} from './entities/balance.entity';

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);

  constructor(
    @InjectRepository(UserBalance)
    private userBalanceRepository: Repository<UserBalance>,
    @InjectRepository(BalanceRecord)
    private balanceRecordRepository: Repository<BalanceRecord>,
    @InjectRepository(Withdrawal)
    private withdrawalRepository: Repository<Withdrawal>,
    private dataSource: DataSource,
    private alipay: AlipayClientService,
  ) {}

  /**
   * 获取或创建用户余额
   */
  async getOrCreateBalance(userId: string): Promise<UserBalance> {
    let balance = await this.userBalanceRepository.findOne({
      where: { userId },
    });

    if (!balance) {
      balance = this.userBalanceRepository.create({
        userId,
        availableCny: 0,
        frozenCny: 0,
        totalIncomeCny: 0,
        totalWithdrawalCny: 0,
      });
      await this.userBalanceRepository.save(balance);
    }

    return balance;
  }

  /**
   * 获取用户余额
   */
  async getBalance(userId: string): Promise<UserBalance> {
    return this.getOrCreateBalance(userId);
  }

  /**
   * 增加可用余额（订单收入 / 充值入账）
   */
  async addIncome(params: {
    userId: string;
    amountCny: number;
    orderId: string;
    description?: string;
    changeType?: BalanceChangeType;
  }): Promise<UserBalance> {
    const { userId, amountCny, orderId, description } = params;
    const changeType = params.changeType ?? BalanceChangeType.ORDER_INCOME;

    if (amountCny <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    return this.dataSource.transaction(async (manager) => {
      // 获取当前余额（加锁）
      let balance = await manager.findOne(UserBalance, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!balance) {
        balance = manager.create(UserBalance, {
          userId,
          availableCny: 0,
          frozenCny: 0,
          totalIncomeCny: 0,
          totalWithdrawalCny: 0,
        });
        await manager.save(balance);
      }

      const beforeBalance = balance.availableCny;
      balance.availableCny += amountCny;
      balance.totalIncomeCny += amountCny;

      await manager.save(balance);

      // 记录变动
      await manager.save(
        this.balanceRecordRepository.create({
          userId,
          amountCny,
          beforeBalanceCny: beforeBalance,
          afterBalanceCny: balance.availableCny,
          changeType,
          orderId,
          description: description || `入账: ${amountCny}分`,
        }),
      );

      return balance;
    });
  }

  /**
   * 余额充值入账（支付宝充值回调成功后调用）
   * 与 addIncome 骨架一致，但 changeType=DEPOSIT，关联 paymentId
   */
  async recharge(params: {
    userId: string;
    amountCny: number;
    paymentId: string;
    description?: string;
  }): Promise<UserBalance> {
    const { userId, amountCny, paymentId, description } = params;

    if (amountCny <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    // 幂等：同一 paymentId 只入账一次（支付宝回调 at-least-once 重投保护）
    const existing = await this.balanceRecordRepository.findOne({
      where: { paymentId },
    });
    if (existing) {
      return this.getOrCreateBalance(userId);
    }

    return this.dataSource.transaction(async (manager) => {
      let balance = await manager.findOne(UserBalance, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!balance) {
        balance = manager.create(UserBalance, {
          userId,
          availableCny: 0,
          frozenCny: 0,
          totalIncomeCny: 0,
          totalWithdrawalCny: 0,
        });
        await manager.save(balance);
      }

      const beforeBalance = balance.availableCny;
      balance.availableCny += amountCny;
      balance.totalIncomeCny += amountCny;

      await manager.save(balance);

      await manager.save(
        this.balanceRecordRepository.create({
          userId,
          amountCny,
          beforeBalanceCny: beforeBalance,
          afterBalanceCny: balance.availableCny,
          changeType: BalanceChangeType.DEPOSIT,
          paymentId,
          description: description || `余额充值: ${amountCny}元`,
        }),
      );

      return balance;
    });
  }

  /**
   * 扣除平台服务费
   */
  async deductPlatformFee(params: {
    userId: string;
    amountCny: number;
    orderId: string;
    description?: string;
  }): Promise<UserBalance> {
    const { userId, amountCny, orderId, description } = params;

    if (amountCny <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    return this.dataSource.transaction(async (manager) => {
      let balance = await manager.findOne(UserBalance, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!balance) {
        balance = manager.create(UserBalance, {
          userId,
          availableCny: 0,
          frozenCny: 0,
          totalIncomeCny: 0,
          totalWithdrawalCny: 0,
        });
        await manager.save(balance);
      }

      const beforeBalance = balance.availableCny;
      balance.availableCny -= amountCny;

      await manager.save(balance);

      await manager.save(
        this.balanceRecordRepository.create({
          userId,
          amountCny: -amountCny,
          beforeBalanceCny: beforeBalance,
          afterBalanceCny: balance.availableCny,
          changeType: BalanceChangeType.PLATFORM_FEE,
          orderId,
          description: description || `平台服务费: ${amountCny}元`,
        }),
      );

      return balance;
    });
  }

  /**
   * 余额支付订单（托管扣款）：可用余额直接支付订单金额进入平台托管
   */
  async payFromBalance(params: {
    userId: string;
    amountCny: number;
    orderId: string;
  }): Promise<UserBalance> {
    const { userId, amountCny, orderId } = params;

    if (amountCny <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    return this.dataSource.transaction(async (manager) => {
      const balance = await manager.findOne(UserBalance, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!balance) {
        throw new BadRequestException('余额账户不存在，请先充值');
      }
      if (balance.availableCny < amountCny) {
        throw new BadRequestException(
          `可用余额不足（需 ${amountCny} 分，可用 ${balance.availableCny} 分）`,
        );
      }

      const beforeBalance = balance.availableCny;
      balance.availableCny -= amountCny;
      await manager.save(balance);

      await manager.save(
        this.balanceRecordRepository.create({
          userId,
          amountCny: -amountCny,
          beforeBalanceCny: beforeBalance,
          afterBalanceCny: balance.availableCny,
          changeType: BalanceChangeType.ORDER_PAYMENT,
          orderId,
          description: `余额支付订单: ${amountCny}分`,
        }),
      );

      return balance;
    });
  }

  /**
   * 申请提现
   */
  async requestWithdrawal(params: {
    userId: string;
    amountCny: number;
    paymentMethod: 'ALIPAY' | 'WECHAT' | 'BANK';
    accountInfo: string;
  }): Promise<Withdrawal> {
    const { userId, amountCny, paymentMethod, accountInfo } = params;

    if (amountCny <= 0) {
      throw new BadRequestException('提现金额必须大于0');
    }

    // 金额单位为分：最低提现 100 元 = 10000 分
    if (amountCny < 10000) {
      throw new BadRequestException('最低提现金额为100元');
    }

    return this.dataSource.transaction(async (manager) => {
      const balance = await manager.findOne(UserBalance, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!balance) {
        throw new NotFoundException('余额账户不存在');
      }

      if (balance.availableCny < amountCny) {
        throw new BadRequestException('可用余额不足');
      }

      // 冻结金额
      const beforeBalance = balance.availableCny;
      balance.availableCny -= amountCny;
      balance.frozenCny += amountCny;

      await manager.save(balance);

      // 创建提现申请
      const withdrawal = await manager.save(
        this.withdrawalRepository.create({
          userId,
          amountCny,
          paymentMethod,
          accountInfo,
          status: WithdrawalStatus.PENDING,
        }),
      );

      // 记录变动
      await manager.save(
        this.balanceRecordRepository.create({
          userId,
          amountCny: -amountCny,
          beforeBalanceCny: beforeBalance,
          afterBalanceCny: balance.availableCny,
          changeType: BalanceChangeType.WITHDRAWAL,
          withdrawalId: withdrawal.id,
          description: `申请提现: ${amountCny}元`,
        }),
      );

      return withdrawal;
    });
  }

  /**
   * 审核提现申请
   */
  async reviewWithdrawal(params: {
    withdrawalId: string;
    adminUserId: string;
    approved: boolean;
    notes?: string;
  }): Promise<Withdrawal> {
    const { withdrawalId, adminUserId, approved, notes } = params;

    let reviewedWithdrawal!: Withdrawal;
    await this.dataSource.transaction(async (manager) => {
      const withdrawal = await manager.findOne(Withdrawal, {
        where: { id: withdrawalId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!withdrawal) {
        throw new NotFoundException('提现申请不存在');
      }

      if (withdrawal.status !== WithdrawalStatus.PENDING) {
        throw new BadRequestException('提现申请已处理');
      }

      const balance = await manager.findOne(UserBalance, {
        where: { userId: withdrawal.userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!balance) {
        throw new NotFoundException('余额账户不存在');
      }

      withdrawal.reviewedBy = adminUserId;
      withdrawal.reviewedAt = new Date();
      withdrawal.reviewNotes = notes || null;

      if (approved) {
        withdrawal.status = WithdrawalStatus.APPROVED;
        // 从冻结金额中扣除
        balance.frozenCny -= withdrawal.amountCny;
        balance.totalWithdrawalCny += withdrawal.amountCny;
      } else {
        withdrawal.status = WithdrawalStatus.REJECTED;
        // 拒绝后解冻金额
        balance.frozenCny -= withdrawal.amountCny;
        balance.availableCny += withdrawal.amountCny;
      }

      const reviewed = await manager.save(withdrawal);
      await manager.save(balance);
      reviewedWithdrawal = reviewed;
    });

    // 自动转账（企业资质 + ALIPAY_TRANSFER_ENABLED=true 时启用；事务外调用外部 API）
    if (
      reviewedWithdrawal.status === WithdrawalStatus.APPROVED &&
      reviewedWithdrawal.paymentMethod === 'ALIPAY' &&
      this.alipay.isTransferEnabled()
    ) {
      try {
        const transfer = await this.alipay.transferToAccount({
          outBizNo: reviewedWithdrawal.id,
          amountCny: reviewedWithdrawal.amountCny,
          payeeAccount: reviewedWithdrawal.accountInfo,
          remark: 'CSI 平台余额提现',
        });
        if (transfer.status === 'SUCCESS' && transfer.orderId) {
          reviewedWithdrawal.status = WithdrawalStatus.COMPLETED;
          reviewedWithdrawal.transactionId = transfer.orderId;
          this.logger.log(
            `提现自动转账成功 | withdrawal=${reviewedWithdrawal.id} alipayOrder=${transfer.orderId}`,
          );
        } else {
          // 转账失败：保持 APPROVED，记录原因，管理员线下打款后手动 complete
          reviewedWithdrawal.reviewNotes = [
            reviewedWithdrawal.reviewNotes,
            `自动转账未成功(${transfer.failReason || '未知原因'})，请线下打款后手动完成`,
          ]
            .filter(Boolean)
            .join('；');
          this.logger.warn(
            `提现自动转账失败 | withdrawal=${reviewedWithdrawal.id} reason=${transfer.failReason}`,
          );
        }
      } catch (error) {
        reviewedWithdrawal.reviewNotes = [
          reviewedWithdrawal.reviewNotes,
          `自动转账异常(${error instanceof Error ? error.message : 'unknown'})，请线下打款后手动完成`,
        ]
          .filter(Boolean)
          .join('；');
        this.logger.error(
          `提现自动转账异常 | withdrawal=${reviewedWithdrawal.id}`,
        );
      }
      await this.withdrawalRepository.save(reviewedWithdrawal);
    }

    return reviewedWithdrawal;
  }

  /**
   * 完成提现（实际转账后调用）
   */
  async completeWithdrawal(params: {
    withdrawalId: string;
    transactionId: string;
  }): Promise<Withdrawal> {
    const { withdrawalId, transactionId } = params;

    const withdrawal = await this.withdrawalRepository.findOne({
      where: { id: withdrawalId },
    });

    if (!withdrawal) {
      throw new NotFoundException('提现申请不存在');
    }

    if (withdrawal.status !== WithdrawalStatus.APPROVED) {
      throw new BadRequestException('提现申请未批准');
    }

    withdrawal.status = WithdrawalStatus.COMPLETED;
    withdrawal.transactionId = transactionId;

    return this.withdrawalRepository.save(withdrawal);
  }

  /**
   * 获取用户的提现记录
   */
  async getWithdrawals(userId: string): Promise<Withdrawal[]> {
    return this.withdrawalRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 获取用户的余额变动记录
   */
  async getBalanceRecords(
    userId: string,
    limit: number = 50,
  ): Promise<BalanceRecord[]> {
    return this.balanceRecordRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * 管理员查询提现列表（可按状态过滤；user 仅暴露 id/displayName/phone）
   */
  async getWithdrawalsForAdmin(status?: string): Promise<unknown[]> {
    const withdrawals = await this.withdrawalRepository.find({
      ...(status ? { where: { status: status as WithdrawalStatus } } : {}),
      order: { createdAt: 'DESC' },
      relations: ['user'],
      take: 200,
    });
    return withdrawals.map((w) => this.toAdminWithdrawalView(w));
  }

  /**
   * 获取所有待审核的提现申请（管理员用）
   */
  async getPendingWithdrawals(): Promise<unknown[]> {
    const withdrawals = await this.withdrawalRepository.find({
      where: { status: WithdrawalStatus.PENDING },
      order: { createdAt: 'ASC' },
      relations: ['user'],
    });
    return withdrawals.map((w) => this.toAdminWithdrawalView(w));
  }

  /** 管理端出参视图：剥离 user 密码哈希等敏感字段 */
  private toAdminWithdrawalView(withdrawal: Withdrawal) {
    const { user, ...rest } = withdrawal;
    return {
      ...rest,
      user: user
        ? { id: user.id, displayName: user.displayName, phone: user.phone }
        : null,
    };
  }
}
