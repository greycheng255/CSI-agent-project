// 创建执行阶段
export class CreatePhaseDto {
  orderId: string;
  phaseKey: string;
  name: string;
  description: string;
  weight: number;
  sequence: number;
  assignedTo?: string;
}

// 创建子任务
export class CreateSubTaskDto {
  phaseId: string;
  taskKey: string;
  name: string;
  description: string;
  weight: number;
  assignedTo?: string;
}

// 更新阶段状态
export class UpdatePhaseStatusDto {
  status:
    | 'PENDING'
    | 'ASSIGNED'
    | 'RUNNING'
    | 'COMPLETED'
    | 'FAILED'
    | 'CANCELLED';
  progress?: number;
  assignedTo?: string;
}

// 更新子任务状态
export class UpdateSubTaskStatusDto {
  status: 'PENDING' | 'ASSIGNED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress?: number;
  result?: string;
  errorMessage?: string;
  outputData?: any;
}

// 上报进度
export class ReportProgressDto {
  orderId: string;
  phaseId?: string;
  subTaskId?: string;
  progress: number;
  event: string; // STARTED, PROGRESS, COMPLETED, FAILED
  message?: string;
  metadata?: any;
  reportedBy: string;
  componentType: string; // AGENT, BRIDGE, OPENCLAW
}

// 添加日志
export class AddLogDto {
  level: 'info' | 'warn' | 'error';
  message: string;
  metadata?: any;
}

// 批量创建执行计划
export class CreateExecutionPlanDto {
  orderId: string;
  phases: Array<{
    phaseKey: string;
    name: string;
    description: string;
    weight: number;
    sequence: number;
    subTasks: Array<{
      taskKey: string;
      name: string;
      description: string;
      weight: number;
    }>;
  }>;
}

// 查询执行进度响应
export class ExecutionProgressResponse {
  orderId: string;
  totalProgress: number;
  status: string;
  phases: Array<{
    id: string;
    phaseKey: string;
    name: string;
    description: string;
    status:
      | 'PENDING'
      | 'ASSIGNED'
      | 'RUNNING'
      | 'COMPLETED'
      | 'FAILED'
      | 'CANCELLED';
    progress: number;
    weight: number;
    sequence: number;
    assignedTo?: string;
    startedAt?: Date;
    completedAt?: Date;
    subTasks: Array<{
      id: string;
      taskKey: string;
      name: string;
      description: string;
      status: 'PENDING' | 'ASSIGNED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
      progress: number;
      weight: number;
      assignedTo?: string;
      logs: Array<{
        time: string;
        level: string;
        message: string;
        metadata: any;
      }>;
      result?: string;
      errorMessage?: string;
      outputData?: any;
      startedAt?: Date;
      completedAt?: Date;
    }>;
  }>;
  traces: Array<{
    id: string;
    event: string;
    message?: string;
    progress?: number;
    reportedBy: string;
    componentType: string;
    createdAt: Date;
  }>;
}
