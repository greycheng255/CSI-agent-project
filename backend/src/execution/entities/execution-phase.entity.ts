import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { ExecutionSubTask } from './execution-subtask.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

// 执行阶段状态
export enum ExecutionPhaseStatus {
  PENDING = 'PENDING', // 待开始
  ASSIGNED = 'ASSIGNED', // 已分配
  RUNNING = 'RUNNING', // 运行中
  COMPLETED = 'COMPLETED', // 已完成
  FAILED = 'FAILED', // 失败
  CANCELLED = 'CANCELLED', // 已取消
}

// 执行阶段实体
@Entity('execution_phases')
export class ExecutionPhase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id' })
  orderId: string;

  @Column({ name: 'phase_key' })
  phaseKey: string; // 如: 'requirement_analysis', 'core_crawling', 'data_storage', 'robustness'

  @Column()
  name: string; // 显示名称: 需求分析

  @Column({ type: 'text' })
  description: string;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: ExecutionPhaseStatus,
    default: ExecutionPhaseStatus.PENDING,
  })
  status: ExecutionPhaseStatus;

  @Column({ type: 'int', default: 0 })
  progress: number; // 0-100

  @Column({ type: 'int', default: 0 })
  weight: number; // 在总体进度中的权重(0-100)

  @Column({ type: 'int', default: 0 })
  sequence: number; // 执行顺序

  @Column({ name: 'assigned_to', nullable: true })
  assignedTo: string; // 分配给哪个组件

  @Column({
    name: 'started_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  startedAt: Date | null;

  @Column({
    name: 'completed_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  completedAt: Date | null;

  @OneToMany(() => ExecutionSubTask, (subTask) => subTask.phase, {
    cascade: true,
    eager: true,
  })
  subTasks: ExecutionSubTask[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // 计算阶段进度（基于子任务）
  calculateProgress(): number {
    if (!this.subTasks || this.subTasks.length === 0) {
      return this.progress;
    }

    const totalWeight = this.subTasks.reduce(
      (sum, t) => sum + (t.weight || 0),
      0,
    );
    if (totalWeight === 0) return 0;

    const weightedProgress = this.subTasks.reduce((sum, t) => {
      return sum + (t.progress || 0) * (t.weight || 0);
    }, 0);

    return Math.round(weightedProgress / totalWeight);
  }
}
