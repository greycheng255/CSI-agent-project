import { GenesisClient } from './genesis-client';
import { getLogger } from '../utils/logger';

const logger = getLogger();

/**
 * 执行追踪器
 * 用于向 Genesis Backend 上报任务执行进度
 */
export class ExecutionTracker {
  private genesisClient: GenesisClient;
  private apiBase: string;
  private agentApiKey: string;

  constructor(genesisClient: GenesisClient, apiBase: string, agentApiKey: string) {
    this.genesisClient = genesisClient;
    this.apiBase = apiBase;
    this.agentApiKey = agentApiKey;
  }

  /**
   * 解析执行计划
   * 支持字符串数组格式（如 【需求分析】xxx）或结构化对象格式
   */
  private parseExecutionPlan(executionPlan: any[]): any[] {
    if (!executionPlan || executionPlan.length === 0) {
      return [];
    }

    // 检查是否是字符串数组格式
    if (typeof executionPlan[0] === 'string') {
      return this.parseStringArrayPlan(executionPlan as string[]);
    }

    // 结构化对象格式
    return executionPlan.map((phase, index) => {
      const phaseKey = phase.key || phase.phaseKey || `phase-${index}`;
      return {
        phaseKey: phaseKey,
        name: phase.name || phase.phaseName || `阶段 ${index + 1}`,
        description: phase.description || '',
        weight: phase.weight || Math.floor(100 / executionPlan.length),
        sequence: index,
        subTasks: phase.subTasks?.map((subTask: any, subIndex: number) => ({
          // 注意：taskKey 格式必须与查询逻辑匹配：phase-${phaseIndex}-${subTaskIndex}
          taskKey: subTask.key || subTask.taskKey || `${phaseKey}-${subIndex}`,
          name: subTask.name || subTask.taskName || `子任务 ${subIndex + 1}`,
          description: subTask.description || '',
          weight: subTask.weight || Math.floor(100 / (phase.subTasks.length || 1)),
        })) || [],
      };
    });
  }

  /**
   * 解析字符串数组格式的执行计划
   * 支持两种格式：
   * 1. 【阶段名称】开头的行作为主阶段，其他行作为子任务
   * 2. 简单的字符串数组，每个字符串作为一个独立的阶段
   */
  private parseStringArrayPlan(planLines: string[]): any[] {
    const phases: any[] = [];
    let currentPhase: any = null;

    // 检测格式：检查是否有以【】开头的行
    const hasFormattedPhases = planLines.some(line => line.trim().match(/^【(.+?)】/));

    // 如果没有格式化阶段，将每个字符串作为独立阶段
    if (!hasFormattedPhases) {
      return planLines.map((line, index) => {
        const phaseKey = `phase-${index}`;
        return {
          phaseKey: phaseKey,
          name: line.trim(),
          description: '',
          weight: Math.floor(100 / planLines.length),
          sequence: index,
          subTasks: [{
            taskKey: `${phaseKey}-0`,
            name: line.trim(),
            description: `执行阶段: ${line.trim()}`,
            weight: 100,
          }],
        };
      });
    }

    // 原有逻辑：处理带【】格式的执行计划
    for (const line of planLines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // 检查是否是主阶段行（以【】开头）
      const mainPhaseMatch = trimmedLine.match(/^【(.+?)】(.+)?$/);
      if (mainPhaseMatch) {
        // 保存上一个阶段
        if (currentPhase) {
          phases.push(currentPhase);
        }
        // 创建新阶段
        const phaseName = mainPhaseMatch[1];
        const phaseDesc = mainPhaseMatch[2]?.trim() || '';
        currentPhase = {
          phaseKey: `phase-${phases.length}`,
          name: phaseName,
          description: phaseDesc,
          weight: 25,
          sequence: phases.length,
          subTasks: [],
        };
      } else if (currentPhase) {
        // 作为子任务添加到当前阶段
        // 注意：taskKey 格式必须与查询逻辑匹配：phase-${phaseIndex}-${subTaskIndex}
        currentPhase.subTasks.push({
          taskKey: `${currentPhase.phaseKey}-${currentPhase.subTasks.length}`,
          name: trimmedLine.substring(0, 100), // 限制长度
          description: trimmedLine,
          weight: Math.floor(100 / 10), // 默认权重
        });
      } else {
        // 没有主阶段时，创建一个默认阶段
        const phaseKey = `phase-${phases.length}`;
        currentPhase = {
          phaseKey: phaseKey,
          name: '任务准备',
          description: '',
          weight: 25,
          sequence: phases.length,
          subTasks: [{
            taskKey: `${phaseKey}-0`,
            name: trimmedLine.substring(0, 100),
            description: trimmedLine,
            weight: 10,
          }],
        };
      }
    }

    // 添加最后一个阶段
    if (currentPhase) {
      phases.push(currentPhase);
    }

    // 如果没有解析到任何阶段，创建一个默认阶段
    if (phases.length === 0) {
      phases.push({
        phaseKey: 'phase-0',
        name: '任务执行',
        description: '执行计划未明确划分阶段',
        weight: 100,
        sequence: 0,
        subTasks: planLines.map((line, idx) => ({
          taskKey: `task-0-${idx}`,
          name: line.trim().substring(0, 100) || `步骤 ${idx + 1}`,
          description: line.trim(),
          weight: Math.floor(100 / planLines.length),
        })).filter(t => t.name),
      });
    }

    // 重新计算权重，确保总和为100
    const weightPerPhase = Math.floor(100 / phases.length);
    phases.forEach((phase, idx) => {
      phase.weight = weightPerPhase;
      phase.sequence = idx;
      if (phase.subTasks.length > 0) {
        const weightPerSubTask = Math.floor(100 / phase.subTasks.length);
        phase.subTasks.forEach((subTask: any, subIdx: number) => {
          subTask.weight = weightPerSubTask;
        });
      }
    });

    return phases;
  }

  /**
   * 创建执行计划
   * 在任务开始执行时调用，初始化整个执行结构
   * 返回创建的 phase 和 subtask ID 映射，用于后续进度上报
   */
  async createExecutionPlan(orderId: string, executionPlan: any[]): Promise<{
    success: boolean;
    phaseIdMap: Map<string, string>; // phaseKey -> phaseId (UUID)
    subTaskIdMap: Map<string, string>; // taskKey -> subTaskId (UUID)
  }> {
    const phaseIdMap = new Map<string, string>();
    const subTaskIdMap = new Map<string, string>();

    try {
      // 解析执行计划 - 支持字符串数组或结构化对象
      const phases = this.parseExecutionPlan(executionPlan);

      const response = await fetch(`${this.apiBase}/api/v1/execution/plans`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-API-Key': this.agentApiKey,
        },
        body: JSON.stringify({
          orderId,
          phases,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create execution plan: ${response.status}`);
      }

      // 解析后端返回的数据，获取真实的 phase 和 subtask ID
      const responseData = await response.json() as { data: Array<{ id: string; phaseKey: string; subTasks: Array<{ id: string; taskKey: string }> }> };

      if (responseData.data && Array.isArray(responseData.data)) {
        for (const phase of responseData.data) {
          if (phase.phaseKey) {
            phaseIdMap.set(phase.phaseKey, phase.id);
          }
          if (phase.subTasks && Array.isArray(phase.subTasks)) {
            for (const subTask of phase.subTasks) {
              if (subTask.taskKey) {
                subTaskIdMap.set(subTask.taskKey, subTask.id);
              }
            }
          }
        }
      }

      logger.info('Execution plan created', {
        orderId,
        phaseCount: phases.length,
        mappedPhases: phaseIdMap.size,
        mappedSubTasks: subTaskIdMap.size,
      });
      console.log(`[EXEC-TRACKER] 执行计划创建成功 | orderId=${orderId} | phases=${phases.length} | mapped=${phaseIdMap.size}`);

      return { success: true, phaseIdMap, subTaskIdMap };
    } catch (error) {
      logger.error('Failed to create execution plan', { orderId, error });
      console.error(`[EXEC-TRACKER] 执行计划创建失败 | orderId=${orderId} | error=${error}`);
      return { success: false, phaseIdMap, subTaskIdMap };
    }
  }

  /**
   * 上报进度
   * 各组件在执行过程中调用
   */
  async reportProgress(params: {
    orderId: string;
    phaseId?: string;
    subTaskId?: string;
    event: 'STARTED' | 'PROGRESS' | 'COMPLETED' | 'FAILED';
    progress: number;
    message?: string;
    metadata?: any;
    componentType: 'AGENT' | 'BRIDGE' | 'OPENCLAW';
  }): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiBase}/api/v1/execution/progress/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-API-Key': this.agentApiKey,
        },
        body: JSON.stringify({
          orderId: params.orderId,
          phaseId: params.phaseId,
          subTaskId: params.subTaskId,
          event: params.event,
          progress: params.progress,
          message: params.message,
          metadata: params.metadata,
          reportedBy: 'genesis-agent',
          componentType: params.componentType,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to report progress: ${response.status}`);
      }

      console.log(`[EXEC-TRACKER] 进度上报 | orderId=${params.orderId} | event=${params.event} | progress=${params.progress}%`);

      return true;
    } catch (error) {
      logger.error('Failed to report progress', { params, error });
      console.error(`[EXEC-TRACKER] 进度上报失败 | orderId=${params.orderId} | error=${error}`);
      return false;
    }
  }

  /**
   * 上报阶段开始
   */
  async reportPhaseStarted(orderId: string, phaseId: string, phaseName: string): Promise<boolean> {
    return this.reportProgress({
      orderId,
      phaseId,
      event: 'STARTED',
      progress: 0,
      message: `阶段 "${phaseName}" 开始执行`,
      componentType: 'AGENT',
    });
  }

  /**
   * 上报阶段完成
   */
  async reportPhaseCompleted(orderId: string, phaseId: string, phaseName: string): Promise<boolean> {
    return this.reportProgress({
      orderId,
      phaseId,
      event: 'COMPLETED',
      progress: 100,
      message: `阶段 "${phaseName}" 执行完成`,
      componentType: 'AGENT',
    });
  }

  /**
   * 上报子任务开始
   */
  async reportSubTaskStarted(
    orderId: string,
    phaseId: string,
    subTaskId: string,
    subTaskName: string,
    componentType: 'AGENT' | 'BRIDGE' | 'OPENCLAW' = 'AGENT'
  ): Promise<boolean> {
    return this.reportProgress({
      orderId,
      phaseId,
      subTaskId,
      event: 'STARTED',
      progress: 0,
      message: `子任务 "${subTaskName}" 开始执行`,
      componentType,
    });
  }

  /**
   * 上报子任务进度
   */
  async reportSubTaskProgress(
    orderId: string,
    phaseId: string,
    subTaskId: string,
    subTaskName: string,
    progress: number,
    message?: string,
    componentType: 'AGENT' | 'BRIDGE' | 'OPENCLAW' = 'AGENT'
  ): Promise<boolean> {
    return this.reportProgress({
      orderId,
      phaseId,
      subTaskId,
      event: 'PROGRESS',
      progress,
      message: message || `子任务 "${subTaskName}" 进度: ${progress}%`,
      componentType,
    });
  }

  /**
   * 上报子任务完成
   */
  async reportSubTaskCompleted(
    orderId: string,
    phaseId: string,
    subTaskId: string,
    subTaskName: string,
    result?: any,
    componentType: 'AGENT' | 'BRIDGE' | 'OPENCLAW' = 'AGENT'
  ): Promise<boolean> {
    return this.reportProgress({
      orderId,
      phaseId,
      subTaskId,
      event: 'COMPLETED',
      progress: 100,
      message: `子任务 "${subTaskName}" 执行完成`,
      metadata: { result },
      componentType,
    });
  }

  /**
   * 上报子任务失败
   */
  async reportSubTaskFailed(
    orderId: string,
    phaseId: string,
    subTaskId: string,
    subTaskName: string,
    error: string,
    componentType: 'AGENT' | 'BRIDGE' | 'OPENCLAW' = 'AGENT'
  ): Promise<boolean> {
    return this.reportProgress({
      orderId,
      phaseId,
      subTaskId,
      event: 'FAILED',
      progress: 0,
      message: `子任务 "${subTaskName}" 执行失败: ${error}`,
      metadata: { error },
      componentType,
    });
  }

  /**
   * 添加子任务日志
   */
  async addSubTaskLog(
    subTaskId: string,
    level: 'info' | 'warn' | 'error',
    message: string,
    metadata?: any
  ): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiBase}/api/v1/execution/sub-tasks/${subTaskId}/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-API-Key': this.agentApiKey,
        },
        body: JSON.stringify({
          level,
          message,
          metadata,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to add log: ${response.status}`);
      }

      return true;
    } catch (error) {
      logger.error('Failed to add subtask log', { subTaskId, error });
      return false;
    }
  }

  /**
   * 获取执行进度
   */
  async getExecutionProgress(orderId: string): Promise<any | null> {
    try {
      const response = await fetch(`${this.apiBase}/api/v1/execution/orders/${orderId}/progress`, {
        headers: {
          'X-Agent-API-Key': this.agentApiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get progress: ${response.status}`);
      }

      const data = await response.json() as { data: any };
      return data.data;
    } catch (error) {
      logger.error('Failed to get execution progress', { orderId, error });
      return null;
    }
  }
}
