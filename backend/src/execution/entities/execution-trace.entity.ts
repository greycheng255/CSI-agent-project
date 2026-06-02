import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const isSqlite = process.env.DB_TYPE === 'sqlite';

// 执行追踪记录（用于时间线）
@Entity('execution_traces')
export class ExecutionTrace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id' })
  orderId: string;

  @Column({ name: 'phase_id', nullable: true })
  phaseId: string;

  @Column({ name: 'sub_task_id', nullable: true })
  subTaskId: string;

  @Column()
  event: string; // 事件类型: CREATED, ASSIGNED, STARTED, PROGRESS, COMPLETED, FAILED

  @Column({ type: 'text', nullable: true })
  message: string; // 事件描述

  @Column({ type: 'int', nullable: true })
  progress: number; // 进度(0-100)

  @Column({ type: 'text', nullable: true })
  metadata: string; // JSON，额外数据

  @Column({ name: 'reported_by' })
  reportedBy: string; // 上报者: genesis-agent, openclaw-bridge, openclaw-agent

  @Column({ name: 'component_type' })
  componentType: string; // 组件类型: AGENT, BRIDGE, OPENCLAW

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
