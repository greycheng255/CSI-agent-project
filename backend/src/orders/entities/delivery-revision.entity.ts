import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Delivery } from './delivery.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

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

  @Column({ name: 'delivery_id', type: 'uuid' })
  deliveryId: string;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: RevisionType,
  })
  type: RevisionType;

  @Column({ name: 'version', type: 'int' })
  version: number;

  @Column({ name: 'delivery_text', type: 'text', nullable: true })
  deliveryText: string | null;

  @Column({ name: 'attachment_url', type: 'text', nullable: true })
  attachmentUrl: string | null;

  @Column({
    name: 'artifact_urls',
    type: process.env.DB_TYPE === 'sqlite' ? 'simple-json' : 'text',
    array: process.env.DB_TYPE !== 'sqlite',
    nullable: true,
  })
  artifactUrls: string[] | null;

  @Column({
    name: 'evidence_bundle',
    type: process.env.DB_TYPE === 'sqlite' ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  evidenceBundle: Record<string, unknown> | null;

  @Column({ name: 'commit_hash', type: 'varchar', nullable: true })
  commitHash: string | null;

  @Column({ name: 'comment', type: 'text', nullable: true })
  comment: string | null;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Delivery, (delivery) => delivery.revisions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'delivery_id' })
  delivery?: Delivery;
}
