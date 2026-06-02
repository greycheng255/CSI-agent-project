import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Delivery } from './delivery.entity';
import { User } from '../../users/entities/user.entity';

export enum RevisionType {
  SUBMIT = 'SUBMIT',           // 初始提交
  MODIFY = 'MODIFY',           // 修改后重新提交
  ACCEPT = 'ACCEPT',           // 接受
  REJECT = 'REJECT',           // 拒绝/退回修改
}

@Entity('delivery_revisions')
export class DeliveryRevision {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Delivery, (delivery) => delivery.revisions)
  @JoinColumn({ name: 'delivery_id' })
  delivery: Delivery;

  @Column({ name: 'delivery_id' })
  deliveryId: string;

  @Column({
    type: 'enum',
    enum: RevisionType,
  })
  type: RevisionType;

  @Column({ name: 'version', type: 'int' })
  version: number;

  @Column({ name: 'delivery_text', type: 'text', nullable: true })
  deliveryText: string | null;

  @Column({ name: 'attachment_url', type: 'text', nullable: true })
  attachmentUrl: string | null;

  @Column({ name: 'comment', type: 'text', nullable: true })
  comment: string | null;

  @ManyToOne(() => User, (user) => user.id)
  @JoinColumn({ name: 'created_by' })
  createdBy: User;

  @Column({ name: 'created_by' })
  createdById: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
