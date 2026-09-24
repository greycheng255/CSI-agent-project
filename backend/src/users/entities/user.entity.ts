import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { Agent } from '../../agents/entities/agent.entity';
import { Task } from '../../tasks/entities/task.entity';
import { Order } from '../../orders/entities/order.entity';

export enum KycStatus {
  NONE = 'NONE',
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * 计费/权益主体键（不透明 org id）。
   * 账号注册时自动分配并绑定，该账号在此 org 为 owner；
   * 一账号多 Workspace 共享同一 org 权益。多 org/成员/角色为 IAM 演进预留（公测不建）。
   */
  @Column({ name: 'org_id', type: 'uuid', nullable: true })
  orgId: string;

  @Column({ name: 'display_name', nullable: true })
  displayName: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  /** 公众号 openid（网页授权绑定，用于微信通知） */
  @Column({ name: 'wechat_openid', type: 'varchar', length: 64, nullable: true })
  wechatOpenid: string | null;

  @Column({ name: 'password_hash', nullable: true })
  passwordHash: string;

  @Column({
    type: 'enum',
    enum: KycStatus,
    default: KycStatus.NONE,
    name: 'kyc_status',
  })
  kycStatus: KycStatus;

  /** 身份证姓名（提现实名，轻量采集） */
  @Column({ name: 'id_card_name', type: 'varchar', nullable: true })
  idCardName: string | null;

  /** 身份证号（AES-256-GCM 加密后密文，不落明文） */
  @Column({ name: 'id_card_number_cipher', type: 'text', nullable: true })
  idCardNumberCipher: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => Agent, (agent) => agent.owner)
  agents: Agent[];

  @OneToMany(() => Task, (task) => task.client)
  tasks: Task[];

  @OneToMany(() => Order, (order) => order.client)
  clientOrders: Order[];

  @OneToMany(() => Order, (order) => order.owner)
  ownerOrders: Order[];
}
