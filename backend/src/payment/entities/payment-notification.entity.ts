import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PaymentProvider } from './payment.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum PaymentNotificationSource {
  CALLBACK = 'CALLBACK',
  QUERY = 'QUERY',
}

/**
 * 支付渠道事件审计日志。
 *
 * 回调原文必须先落库再改变订单状态，便于对账和排查签名、金额或商户
 * 身份不一致的问题。notifyId 在渠道提供时用于阻止同一通知重复处理。
 */
@Entity('payment_notification_logs')
@Index('idx_payment_notify_provider_id', ['provider', 'notifyId'], {
  unique: true,
})
@Index('idx_payment_notify_trade_time', ['outTradeNo', 'createdAt'])
export class PaymentNotification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: PaymentProvider,
  })
  provider: PaymentProvider;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: PaymentNotificationSource,
  })
  source: PaymentNotificationSource;

  @Column({ name: 'notify_id', type: 'varchar', length: 128, nullable: true })
  notifyId: string | null;

  @Column({
    name: 'out_trade_no',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  outTradeNo: string | null;

  @Column({ name: 'trade_no', type: 'varchar', length: 128, nullable: true })
  tradeNo: string | null;

  @Column({ name: 'signature_valid', type: 'boolean', default: false })
  signatureValid: boolean;

  @Column({ type: 'boolean', default: false })
  processed: boolean;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({
    name: 'raw_payload',
    type: isSqlite ? 'simple-json' : 'jsonb',
  })
  rawPayload: Record<string, string>;

  @Column({ name: 'client_ip', type: 'varchar', length: 128, nullable: true })
  clientIp: string | null;

  @Column({
    name: 'processed_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  processedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
