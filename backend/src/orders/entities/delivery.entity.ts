import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Order } from './order.entity';
import { User } from '../../users/entities/user.entity';
import { DeliveryRevision } from './delivery-revision.entity';

export enum DeliveryStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',     // 待审核
  ACCEPTED = 'ACCEPTED',                  // 已接受
  REJECTED = 'REJECTED',                  // 已拒绝/需修改
  SUPERSEDED = 'SUPERSEDED',             // 已被新版本替代
}

@Entity('deliveries')
export class Delivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, (order) => order.deliveries)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @ManyToOne(() => User, (user) => user.id)
  @JoinColumn({ name: 'owner_user_id' })
  owner: User;

  @Column({ name: 'version', type: 'int', default: 1 })
  version: number;

  @Column({
    type: 'enum',
    enum: DeliveryStatus,
    default: DeliveryStatus.PENDING_REVIEW,
  })
  status: DeliveryStatus;

  @Column({ name: 'delivery_text', type: 'text', nullable: true })
  deliveryText: string | null;

  @Column({ name: 'attachment_url', type: 'text', nullable: true })
  attachmentUrl: string | null;

  @Column({ name: 'preview_data', type: 'jsonb', nullable: true })
  previewData: {
    type: 'code' | 'text' | 'link' | 'image';
    content: string;
    language?: string;
  } | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'rejected_at', type: 'timestamp', nullable: true })
  rejectedAt: Date | null;

  @Column({ name: 'accepted_at', type: 'timestamp', nullable: true })
  acceptedAt: Date | null;

  @OneToMany(() => DeliveryRevision, (revision) => revision.delivery)
  revisions: DeliveryRevision[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
