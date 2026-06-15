import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum DeliveryStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  SUPERSEDED = 'SUPERSEDED',
}

@Entity('deliveries')
export class Delivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId: string | null;

  @Column({ name: 'version', type: 'int', default: 1 })
  version: number;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: DeliveryStatus,
    default: DeliveryStatus.PENDING_REVIEW,
  })
  status: DeliveryStatus;

  @Column({ name: 'delivery_text', type: 'text', nullable: true })
  deliveryText: string | null;

  @Column({ name: 'attachment_url', type: 'text', nullable: true })
  attachmentUrl: string | null;

  @Column({
    name: 'preview_data',
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  previewData: {
    type: 'code' | 'text' | 'link' | 'image';
    content: string;
    language?: string;
  } | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({
    name: 'rejected_at',
    type: isSqlite ? 'datetime' : 'timestamp',
    nullable: true,
  })
  rejectedAt: Date | null;

  @Column({
    name: 'accepted_at',
    type: isSqlite ? 'datetime' : 'timestamp',
    nullable: true,
  })
  acceptedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
