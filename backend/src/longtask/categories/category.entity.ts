import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

/**
 * 平台类目树节点（PRD §4.5 / §4.1「平台类目树」）。
 *
 * - 树形结构：parent_id 自引用，根节点 parent_id 为 null
 * - 叶子节点（无子节点）才允许被任务/工作室引用，避免匹配模糊
 * - slug 全局唯一，便于人类可读引用与 URL
 * - is_active=false 表示平台运营方下架（历史引用保留，新发布禁止）
 */
@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_categories_parent')
  @Column({
    name: 'parent_id',
    type: isSqlite ? 'varchar' : 'uuid',
    nullable: true,
  })
  parentId: string | null;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  slug: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
