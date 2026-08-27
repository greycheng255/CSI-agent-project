/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ExecutionPhase,
  ExecutionSubTask,
  ExecutionTrace,
  ExecutionPhaseStatus,
  SubTaskStatus,
} from './entities';
import {
  UpdatePhaseStatusDto,
  UpdateSubTaskStatusDto,
  ReportProgressDto,
  AddLogDto,
  CreateExecutionPlanDto,
  ExecutionProgressResponse,
} from './dto/execution.dto';
import { Order, OrderStatus } from '../orders/entities/order.entity';

@Injectable()
export class ExecutionService {
  constructor(
    @InjectRepository(ExecutionPhase)
    private phaseRepository: Repository<ExecutionPhase>,
    @InjectRepository(ExecutionSubTask)
    private subTaskRepository: Repository<ExecutionSubTask>,
    @InjectRepository(ExecutionTrace)
    private traceRepository: Repository<ExecutionTrace>,
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
  ) {}

  // 创建执行计划（初始化整个任务的执行结构）
  async createExecutionPlan(
    dto: CreateExecutionPlanDto,
  ): Promise<ExecutionPhase[]> {
    // 先删除该订单已有的执行计划（支持覆盖更新）
    const existingPhases = await this.phaseRepository.find({
      where: { orderId: dto.orderId },
      relations: ['subTasks'],
    });

    for (const phase of existingPhases) {
      if (phase.subTasks && phase.subTasks.length > 0) {
        await this.subTaskRepository.remove(phase.subTasks);
      }
    }
    if (existingPhases.length > 0) {
      await this.phaseRepository.remove(existingPhases);
    }

    const phases: ExecutionPhase[] = [];

    for (const phaseData of dto.phases) {
      // 创建阶段
      const phase = this.phaseRepository.create({
        orderId: dto.orderId,
        phaseKey: phaseData.phaseKey,
        name: phaseData.name,
        description: phaseData.description,
        status: ExecutionPhaseStatus.PENDING,
        progress: 0,
        weight: phaseData.weight,
        sequence: phaseData.sequence,
      });

      const savedPhase = await this.phaseRepository.save(phase);

      // 创建子任务
      const subTasks: ExecutionSubTask[] = [];
      for (const subTaskData of phaseData.subTasks) {
        const subTask = this.subTaskRepository.create({
          phaseId: savedPhase.id,
          taskKey: subTaskData.taskKey,
          name: subTaskData.name,
          description: subTaskData.description,
          status: SubTaskStatus.PENDING,
          progress: 0,
          weight: subTaskData.weight,
          logs: '[]',
        });
        subTasks.push(subTask);
      }

      savedPhase.subTasks = await this.subTaskRepository.save(subTasks);
      phases.push(savedPhase);

      // 记录追踪日志
      await this.createTrace({
        orderId: dto.orderId,
        phaseId: savedPhase.id,
        event: 'PHASE_CREATED',
        message: `阶段 "${phaseData.name}" 已创建`,
        reportedBy: 'system',
        componentType: 'SYSTEM',
      });
    }

    // 记录整个计划创建
    await this.createTrace({
      orderId: dto.orderId,
      event: 'PLAN_CREATED',
      message: `执行计划已创建，共 ${dto.phases.length} 个阶段`,
      reportedBy: 'system',
      componentType: 'SYSTEM',
    });

    return phases;
  }

  // 获取执行进度
  async getExecutionProgress(
    orderId: string,
  ): Promise<ExecutionProgressResponse> {
    const phases = await this.phaseRepository.find({
      where: { orderId },
      order: { sequence: 'ASC' },
    });

    const traces = await this.traceRepository.find({
      where: { orderId },
      order: { createdAt: 'DESC' },
      take: 50,
    });

    // 计算总体进度
    const totalWeight = phases.reduce((sum, p) => sum + p.weight, 0);
    const totalProgress =
      totalWeight > 0
        ? Math.round(
            phases.reduce((sum, p) => sum + p.progress * p.weight, 0) /
              totalWeight,
          )
        : 0;

    // 确定总体状态
    let status = 'PENDING';
    if (phases.some((p) => p.status === ExecutionPhaseStatus.RUNNING)) {
      status = 'RUNNING';
    } else if (
      phases.every((p) => p.status === ExecutionPhaseStatus.COMPLETED)
    ) {
      status = 'COMPLETED';
    } else if (phases.some((p) => p.status === ExecutionPhaseStatus.FAILED)) {
      status = 'FAILED';
    }

    return {
      orderId,
      totalProgress,
      status,
      phases: phases.map((phase) => ({
        id: phase.id,
        phaseKey: phase.phaseKey,
        name: phase.name,
        description: phase.description,
        status: phase.status,
        progress: phase.progress,
        weight: phase.weight,
        sequence: phase.sequence,
        assignedTo: phase.assignedTo || undefined,
        startedAt: phase.startedAt || undefined,
        completedAt: phase.completedAt || undefined,
        subTasks:
          phase.subTasks?.map((subTask) => ({
            id: subTask.id,
            taskKey: subTask.taskKey,
            name: subTask.name,
            description: subTask.description,
            status: subTask.status,
            progress: subTask.progress,
            weight: subTask.weight,
            assignedTo: subTask.assignedTo || undefined,
            logs: subTask.getLogs(),
            result: subTask.result || undefined,
            errorMessage: subTask.errorMessage || undefined,
            outputData: subTask.outputData
              ? JSON.parse(subTask.outputData)
              : undefined,
            startedAt: subTask.startedAt || undefined,
            completedAt: subTask.completedAt || undefined,
          })) || [],
      })),
      traces: traces.map((t) => ({
        id: t.id,
        event: t.event,
        message: t.message || undefined,
        progress: t.progress || undefined,
        reportedBy: t.reportedBy,
        componentType: t.componentType,
        createdAt: t.createdAt,
      })),
    };
  }

  // 更新阶段状态
  async updatePhaseStatus(
    phaseId: string,
    dto: UpdatePhaseStatusDto,
  ): Promise<ExecutionPhase> {
    const phase = await this.phaseRepository.findOne({
      where: { id: phaseId },
      relations: ['subTasks'],
    });

    if (!phase) {
      throw new NotFoundException('Phase not found');
    }

    const oldStatus = phase.status;
    phase.status = dto.status as ExecutionPhaseStatus;

    if (dto.progress !== undefined) {
      phase.progress = dto.progress;
    }

    if (dto.assignedTo) {
      phase.assignedTo = dto.assignedTo;
    }

    // 更新开始/完成时间
    if (dto.status === ExecutionPhaseStatus.RUNNING && !phase.startedAt) {
      phase.startedAt = new Date();
    }
    if (
      (dto.status === ExecutionPhaseStatus.COMPLETED ||
        dto.status === ExecutionPhaseStatus.FAILED) &&
      !phase.completedAt
    ) {
      phase.completedAt = new Date();
    }

    const saved = await this.phaseRepository.save(phase);

    // 记录追踪
    await this.createTrace({
      orderId: phase.orderId,
      phaseId: phase.id,
      event: `PHASE_${dto.status}`,
      message: `阶段 "${phase.name}" 状态变更: ${oldStatus} -> ${dto.status}`,
      progress: phase.progress,
      reportedBy: 'system',
      componentType: 'SYSTEM',
    });

    return saved;
  }

  // 更新子任务状态
  async updateSubTaskStatus(
    subTaskId: string,
    dto: UpdateSubTaskStatusDto,
  ): Promise<ExecutionSubTask> {
    const subTask = await this.subTaskRepository.findOne({
      where: { id: subTaskId },
    });

    if (!subTask) {
      throw new NotFoundException('SubTask not found');
    }

    const oldStatus = subTask.status;
    subTask.status = dto.status as SubTaskStatus;

    if (dto.progress !== undefined) {
      subTask.progress = dto.progress;
    }

    if (dto.result !== undefined) {
      subTask.result = dto.result;
    }

    if (dto.errorMessage !== undefined) {
      subTask.errorMessage = dto.errorMessage;
    }

    if (dto.outputData !== undefined) {
      subTask.outputData = JSON.stringify(dto.outputData);
    }

    // 更新开始/完成时间
    if (dto.status === SubTaskStatus.RUNNING && !subTask.startedAt) {
      subTask.startedAt = new Date();
    }
    if (
      (dto.status === SubTaskStatus.COMPLETED ||
        dto.status === SubTaskStatus.FAILED) &&
      !subTask.completedAt
    ) {
      subTask.completedAt = new Date();
    }

    const saved = await this.subTaskRepository.save(subTask);

    // 添加日志
    saved.addLog('info', `状态变更: ${oldStatus} -> ${dto.status}`, {
      progress: dto.progress,
    });
    await this.subTaskRepository.save(saved);

    // 记录追踪
    const phase = await this.phaseRepository.findOne({
      where: { id: subTask.phaseId },
    });
    if (phase) {
      await this.createTrace({
        orderId: phase.orderId,
        phaseId: phase.id,
        subTaskId: subTask.id,
        event: `SUBTASK_${dto.status}`,
        message: `子任务 "${subTask.name}" 状态变更: ${oldStatus} -> ${dto.status}`,
        progress: subTask.progress,
        reportedBy: 'system',
        componentType: 'SYSTEM',
      });

      // 重新计算阶段进度
      await this.recalculatePhaseProgress(phase.id);
    }

    return saved;
  }

  // 上报进度（通用接口）
  async reportProgress(dto: ReportProgressDto): Promise<void> {
    // 记录追踪
    await this.createTrace({
      orderId: dto.orderId,
      phaseId: dto.phaseId,
      subTaskId: dto.subTaskId,
      event: dto.event,
      message: dto.message,
      progress: dto.progress,
      metadata: dto.metadata,
      reportedBy: dto.reportedBy,
      componentType: dto.componentType,
    });

    // 更新子任务进度
    if (dto.subTaskId) {
      const subTask = await this.subTaskRepository.findOne({
        where: { id: dto.subTaskId },
      });

      if (subTask) {
        subTask.progress = dto.progress;

        // 根据事件更新状态
        if (dto.event === 'STARTED') {
          subTask.status = SubTaskStatus.RUNNING;
          subTask.startedAt = new Date();
        } else if (dto.event === 'COMPLETED') {
          subTask.status = SubTaskStatus.COMPLETED;
          subTask.progress = 100;
          subTask.completedAt = new Date();
          if (dto.metadata?.result) {
            subTask.result = dto.metadata.result;
          }
        } else if (dto.event === 'FAILED') {
          subTask.status = SubTaskStatus.FAILED;
          if (dto.metadata?.error) {
            subTask.errorMessage = dto.metadata.error;
          }
        }

        // 添加日志
        subTask.addLog(
          dto.event === 'FAILED' ? 'error' : 'info',
          dto.message || `进度更新: ${dto.progress}%`,
          dto.metadata,
        );

        await this.subTaskRepository.save(subTask);

        // 重新计算阶段进度
        const phase = await this.phaseRepository.findOne({
          where: { id: subTask.phaseId },
        });
        if (phase) {
          await this.recalculatePhaseProgress(phase.id);
        }
      }
    }

    // 更新阶段进度
    if (dto.phaseId && !dto.subTaskId) {
      const phase = await this.phaseRepository.findOne({
        where: { id: dto.phaseId },
      });

      if (phase) {
        phase.progress = dto.progress;

        if (dto.event === 'STARTED') {
          phase.status = ExecutionPhaseStatus.RUNNING;
          phase.startedAt = new Date();
        } else if (dto.event === 'COMPLETED') {
          phase.status = ExecutionPhaseStatus.COMPLETED;
          phase.progress = 100;
          phase.completedAt = new Date();
        } else if (dto.event === 'FAILED') {
          phase.status = ExecutionPhaseStatus.FAILED;
        }

        await this.phaseRepository.save(phase);
      }
    }
  }

  // 添加子任务日志
  async addSubTaskLog(subTaskId: string, dto: AddLogDto): Promise<void> {
    const subTask = await this.subTaskRepository.findOne({
      where: { id: subTaskId },
    });

    if (!subTask) {
      throw new NotFoundException('SubTask not found');
    }

    subTask.addLog(dto.level, dto.message, dto.metadata);
    await this.subTaskRepository.save(subTask);
  }

  // 重新计算阶段进度
  private async recalculatePhaseProgress(phaseId: string): Promise<void> {
    const phase = await this.phaseRepository.findOne({
      where: { id: phaseId },
      relations: ['subTasks'],
    });

    if (!phase || !phase.subTasks || phase.subTasks.length === 0) {
      return;
    }

    // 检查是否所有子任务都已完成
    const allSubTasksCompleted = phase.subTasks.every(
      (task) => task.status === SubTaskStatus.COMPLETED,
    );

    // 如果所有子任务都完成，阶段进度直接设为100%
    const newProgress = allSubTasksCompleted ? 100 : phase.calculateProgress();

    // 如果进度有变化，更新并记录
    if (newProgress !== phase.progress || allSubTasksCompleted) {
      phase.progress = newProgress;

      // 自动更新状态
      if (
        newProgress === 100 &&
        phase.status !== ExecutionPhaseStatus.COMPLETED
      ) {
        phase.status = ExecutionPhaseStatus.COMPLETED;
        phase.completedAt = new Date();
      } else if (
        newProgress > 0 &&
        phase.status === ExecutionPhaseStatus.PENDING
      ) {
        phase.status = ExecutionPhaseStatus.RUNNING;
        phase.startedAt = new Date();
      }

      await this.phaseRepository.save(phase);

      // 记录进度更新
      await this.createTrace({
        orderId: phase.orderId,
        phaseId: phase.id,
        event: allSubTasksCompleted ? 'PHASE_COMPLETED' : 'PHASE_PROGRESS',
        message: `阶段 "${phase.name}" 进度更新: ${newProgress}%`,
        progress: newProgress,
        reportedBy: 'system',
        componentType: 'SYSTEM',
      });
    }
  }

  // 创建追踪记录
  private async createTrace(
    data: Partial<ExecutionTrace>,
  ): Promise<ExecutionTrace> {
    const trace = this.traceRepository.create(data);
    return this.traceRepository.save(trace);
  }

  // 获取订单的所有阶段
  async getPhasesByOrder(orderId: string): Promise<ExecutionPhase[]> {
    return this.phaseRepository.find({
      where: { orderId },
      order: { sequence: 'ASC' },
      relations: ['subTasks'],
    });
  }

  // 获取阶段的子任务
  async getSubTasksByPhase(phaseId: string): Promise<ExecutionSubTask[]> {
    return this.subTaskRepository.find({
      where: { phaseId },
      order: { createdAt: 'ASC' },
    });
  }

  // Retry execution by resetting platform state. HiClaw consumes the order again through MCP.
  async retryExecution(orderId: string): Promise<any> {
    try {
      // 1. 重置订单状态为 IN_PROGRESS
      const order = await this.orderRepository.findOne({
        where: { id: orderId },
        relations: ['owner', 'client', 'task'],
      });
      if (!order) {
        throw new Error('Order not found');
      }

      const oldStatus = order.status;
      order.status = OrderStatus.IN_PROGRESS;
      order.deliveredAt = null;
      order.deliveryUrl = null;
      order.deliverySummary = null;
      await this.orderRepository.save(order);
      console.log(
        `[RETRY] Order ${orderId} status reset from ${oldStatus} to IN_PROGRESS`,
      );

      // 2. 重置执行阶段状态（删除失败的执行计划，让 Agent 重新创建）
      const existingPhases = await this.phaseRepository.find({
        where: { orderId },
        relations: ['subTasks'],
      });
      for (const phase of existingPhases) {
        if (phase.subTasks && phase.subTasks.length > 0) {
          await this.subTaskRepository.remove(phase.subTasks);
        }
      }
      if (existingPhases.length > 0) {
        await this.phaseRepository.remove(existingPhases);
        console.log(`[RETRY] Execution phases for order ${orderId} cleared`);
      }

      await this.createTrace({
        orderId,
        event: 'RETRY_QUEUED_FOR_MCP',
        message:
          '用户手动触发重试，订单和执行计划已重置，等待 HiClaw Controller 通过 MCP 重新消费并回写执行进度',
        metadata: JSON.stringify({
          retryMethod: 'mcp_pull',
          orderStatusReset: true,
          phasesCleared: existingPhases.length,
          timestamp: new Date().toISOString(),
        }),
        reportedBy: 'user',
        componentType: 'SYSTEM',
      });

      return {
        orderId,
        status: 'RETRY_QUEUED_FOR_MCP',
        message:
          '重试状态已重置，请由 HiClaw Controller 通过 MCP 拉取订单并继续执行',
        method: 'mcp_pull',
      };
    } catch (error: any) {
      // 记录错误
      await this.createTrace({
        orderId,
        event: 'RETRY_FAILED',
        message: `重试触发失败: ${error.message}`,
        metadata: JSON.stringify({
          error: error.message,
          timestamp: new Date().toISOString(),
        }),
        reportedBy: 'user',
        componentType: 'SYSTEM',
      });

      throw new Error(`重试任务失败: ${error.message}`);
    }
  }
}
