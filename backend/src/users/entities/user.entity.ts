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

  @Column({ name: 'password_hash', nullable: true })
  passwordHash: string;

  @Column({
    type: 'enum',
    enum: KycStatus,
    default: KycStatus.NONE,
    name: 'kyc_status',
  })
  kycStatus: KycStatus;

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
