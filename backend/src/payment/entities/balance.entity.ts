import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

/**
 * 余额变动类型
 */
export enum BalanceChangeType {
  // 收入
  ORDER_INCOME = 'ORDER_INCOME', // 订单收入
  REFUND = 'REFUND', // 退款
  DEPOSIT = 'DEPOSIT', // 充值

  // 支出
  WITHDRAWAL = 'WITHDRAWAL', // 提现
  PLATFORM_FEE = 'PLATFORM_FEE', // 平台服务费
  PENALTY = 'PENALTY', // 罚款
}

/**
 * 余额变动记录
 */
@Entity('balance_records')
@Index(['userId', 'createdAt'])
export class BalanceRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.id)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  // 变动金额（正数表示收入，负数表示支出）
  @Column({ name: 'amount_cny', type: 'int' })
  amountCny: number;

  // 变动前余额
  @Column({ name: 'before_balance_cny', type: 'int' })
  beforeBalanceCny: number;

  // 变动后余额
  @Column({ name: 'after_balance_cny', type: 'int' })
  afterBalanceCny: number;

  // 变动类型
  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: BalanceChangeType,
  })
  changeType: BalanceChangeType;

  // 关联订单ID
  @Column({ name: 'order_id', nullable: true })
  orderId: string | null;

  // 关联提现申请ID
  @Column({ name: 'withdrawal_id', nullable: true })
  withdrawalId: string | null;

  // 描述
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

/**
 * 用户余额
 */
@Entity('user_balances')
export class UserBalance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.id)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', unique: true })
  userId: string;

  // 可用余额（可提现）
  @Column({ name: 'available_cny', type: 'int', default: 0 })
  availableCny: number;

  // 冻结余额（提现中、争议中）
  @Column({ name: 'frozen_cny', type: 'int', default: 0 })
  frozenCny: number;

  // 累计收入
  @Column({ name: 'total_income_cny', type: 'int', default: 0 })
  totalIncomeCny: number;

  // 累计提现
  @Column({ name: 'total_withdrawal_cny', type: 'int', default: 0 })
  totalWithdrawalCny: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

/**
 * 提现申请状态
 */
export enum WithdrawalStatus {
  PENDING = 'PENDING', // 待审核
  APPROVED = 'APPROVED', // 已批准
  REJECTED = 'REJECTED', // 已拒绝
  PROCESSING = 'PROCESSING', // 处理中
  COMPLETED = 'COMPLETED', // 已完成
  FAILED = 'FAILED', // 失败
}

/**
 * 提现申请
 */
@Entity('withdrawals')
@Index(['userId', 'createdAt'])
export class Withdrawal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.id)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  // 提现金额
  @Column({ name: 'amount_cny', type: 'int' })
  amountCny: number;

  // 提现方式
  @Column({ name: 'payment_method', type: 'varchar', length: 20 })
  paymentMethod: 'ALIPAY' | 'WECHAT' | 'BANK';

  // 收款账号
  @Column({ name: 'account_info', type: 'text' })
  accountInfo: string;

  // 状态
  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: WithdrawalStatus,
    default: WithdrawalStatus.PENDING,
  })
  status: WithdrawalStatus;

  // 审核人
  @Column({ name: 'reviewed_by', nullable: true })
  reviewedBy: string | null;

  // 审核时间
  @Column({
    name: 'reviewed_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  reviewedAt: Date | null;

  // 审核备注
  @Column({ name: 'review_notes', type: 'text', nullable: true })
  reviewNotes: string | null;

  // 交易ID
  @Column({
    name: 'transaction_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  transactionId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
