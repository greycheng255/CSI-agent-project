import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PlatformCodeType {
  ALIPAY = 'ALIPAY',
  WECHAT = 'WECHAT',
}

@Entity('platform_payment_codes')
export class PlatformPaymentCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: PlatformCodeType,
  })
  type: PlatformCodeType;

  @Column({ name: 'qr_code_url', type: 'text' })
  qrCodeUrl: string;

  @Column({ name: 'account_name', type: 'varchar', length: 100 })
  accountName: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
