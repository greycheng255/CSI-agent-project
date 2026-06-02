import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { User } from '../../users/entities/user.entity';

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

  @Column({ name: 'delivery_text', type: 'text', nullable: true })
  deliveryText: string | null;

  @Column({ name: 'attachment_url', type: 'text', nullable: true })
  attachmentUrl: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
