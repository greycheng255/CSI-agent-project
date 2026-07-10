import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum ChecklistItemStatus {
  PENDING = 'PENDING',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  NA = 'NA',
}

@Entity('acceptance_checklists')
export class AcceptanceChecklist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'item_index', type: 'int', nullable: true })
  itemIndex: number | null;

  @Column({ name: 'criterion', type: 'text' })
  criterion: string;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: ChecklistItemStatus,
    default: ChecklistItemStatus.PENDING,
  })
  status: ChecklistItemStatus;

  @Column({ name: 'checked_by_id', type: 'uuid', nullable: true })
  checkedById: string | null;

  @Column({
    name: 'checked_at',
    type: isSqlite ? 'datetime' : 'timestamp',
    nullable: true,
  })
  checkedAt: Date | null;

  @Column({ name: 'comment', type: 'text', nullable: true })
  comment: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
