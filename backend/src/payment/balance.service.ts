import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  UserBalance,
  BalanceRecord,
  BalanceChangeType,
  Withdrawal,
  WithdrawalStatus,
} from './entities/balance.entity';

@Injectable()
export class BalanceService {
  constructor(
    @InjectRepository(UserBalance)
    private userBalanceRepository: Repository<UserBalance>,
    @InjectRepository(BalanceRecord)
    private balanceRecordRepository: Repository<BalanceRecord>,
    @InjectRepository(Withdrawal)
    private withdrawalRepository: Repository<Withdrawal>,
    private dataSource: DataSource,
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
   * 增加可用余额（订单收入）
   */
  async addIncome(params: {
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
          changeType: BalanceChangeType.ORDER_INCOME,
          orderId,
          description: description || `订单收入: ${amountCny}元`,
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

    if (amountCny < 100) {
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

    return this.dataSource.transaction(async (manager) => {
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

      await manager.save(withdrawal);
      await manager.save(balance);

      return withdrawal;
    });
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
   * 获取所有待审核的提现申请（管理员用）
   */
  async getPendingWithdrawals(): Promise<Withdrawal[]> {
    return this.withdrawalRepository.find({
      where: { status: WithdrawalStatus.PENDING },
      order: { createdAt: 'ASC' },
      relations: ['user'],
    });
  }
}
