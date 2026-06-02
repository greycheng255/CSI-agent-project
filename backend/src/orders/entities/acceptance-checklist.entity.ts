import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { User } from '../../users/entities/user.entity';

export enum ChecklistItemStatus {
  PENDING = 'PENDING',       // 待检查
  PASSED = 'PASSED',         // 通过
  FAILED = 'FAILED',         // 未通过
  NA = 'NA',                 // 不适用
}

@Entity('acceptance_checklists')
export class AcceptanceChecklist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, (order) => order.checklistItems)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ name: 'order_id' })
  orderId: string;

  @Column({ name: 'item_index', type: 'int' })
  itemIndex: number;

  @Column({ name: 'criteria_text', type: 'text' })
  criteriaText: string;

  @Column({
    type: 'enum',
    enum: ChecklistItemStatus,
    default: ChecklistItemStatus.PENDING,
  })
  status: ChecklistItemStatus;

  @Column({ name: 'checked_by', nullable: true })
  checkedById: string | null;

  @ManyToOne(() => User, (user) => user.id)
  @JoinColumn({ name: 'checked_by' })
  checkedBy: User;

  @Column({ name: 'checked_at', type: 'timestamp', nullable: true })
  checkedAt: Date | null;

  @Column({ name: 'comment', type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
