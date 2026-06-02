/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ExecutionPhase } from './execution-phase.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

// 子任务状态
export enum SubTaskStatus {
  PENDING = 'PENDING', // 待开始
  ASSIGNED = 'ASSIGNED', // 已分配
  RUNNING = 'RUNNING', // 运行中
  COMPLETED = 'COMPLETED', // 已完成
  FAILED = 'FAILED', // 失败
}

// 子任务实体
@Entity('execution_sub_tasks')
export class ExecutionSubTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ExecutionPhase, (phase) => phase.subTasks)
  @JoinColumn({ name: 'phase_id' })
  phase: ExecutionPhase;

  @Column({ name: 'phase_id' })
  phaseId: string;

  @Column({ name: 'task_key' })
  taskKey: string; // 如: 'http_module', 'html_parser', 'data_extraction'

  @Column()
  name: string; // 显示名称: HTTP请求模块

  @Column({ type: 'text' })
  description: string;

  @Column({
    type: isSqlite ? 'simple-enum' : 'enum',
    enum: SubTaskStatus,
    default: SubTaskStatus.PENDING,
  })
  status: SubTaskStatus;

  @Column({ type: 'int', default: 0 })
  progress: number; // 0-100

  @Column({ type: 'int', default: 0 })
  weight: number; // 在阶段内的权重(0-100)

  @Column({ type: 'text', nullable: true })
  logs: string; // JSON数组，存储执行日志

  @Column({ type: 'text', nullable: true })
  result: string; // 执行结果摘要

  @Column({ type: 'text', nullable: true })
  errorMessage: string; // 错误信息

  @Column({ type: 'text', nullable: true })
  outputData: string; // JSON，输出数据

  @Column({ name: 'assigned_to', nullable: true })
  assignedTo: string; // 分配给哪个组件(agent/openclaw/bridge)

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // 辅助方法
  addLog(
    level: 'info' | 'warn' | 'error',
    message: string,
    metadata?: any,
  ): void {
    const logs = this.logs ? JSON.parse(this.logs) : [];
    logs.push({
      time: new Date().toISOString(),
      level,
      message,
      metadata: metadata || null,
    });
    this.logs = JSON.stringify(logs);
  }

  getLogs(): Array<{
    time: string;
    level: string;
    message: string;
    metadata: any;
  }> {
    return this.logs ? JSON.parse(this.logs) : [];
  }
}
