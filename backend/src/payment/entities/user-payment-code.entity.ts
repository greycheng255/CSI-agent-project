import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum PaymentCodeType {
  ALIPAY = 'ALIPAY',
  WECHAT = 'WECHAT',
}

@Entity('user_payment_codes')
export class UserPaymentCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.id)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: PaymentCodeType,
  })
  type: PaymentCodeType;

  @Column({ name: 'qr_code_url', type: 'text' })
  qrCodeUrl: string;

  @Column({
    name: 'account_name',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  accountName: string | null;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
