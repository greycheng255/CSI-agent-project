/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Controller, Get, Post, Put, Body, Param } from '@nestjs/common';
import { ExecutionService } from './execution.service';
import {
  CreateExecutionPlanDto,
  UpdatePhaseStatusDto,
  UpdateSubTaskStatusDto,
  ReportProgressDto,
  AddLogDto,
} from './dto/execution.dto';

@Controller('api/v1/execution')
export class ExecutionController {
  constructor(private readonly executionService: ExecutionService) {}

  // 创建执行计划（内部API，由Agent调用）
  @Post('plans')
  async createExecutionPlan(@Body() dto: CreateExecutionPlanDto) {
    const phases = await this.executionService.createExecutionPlan(dto);
    return {
      success: true,
      data: phases,
    };
  }

  // 获取执行进度（供前端查询）
  @Get('orders/:orderId/progress')
  async getExecutionProgress(@Param('orderId') orderId: string) {
    const progress = await this.executionService.getExecutionProgress(orderId);
    return {
      success: true,
      data: progress,
    };
  }

  // 获取订单的所有阶段
  @Get('orders/:orderId/phases')
  async getPhasesByOrder(@Param('orderId') orderId: string) {
    const phases = await this.executionService.getPhasesByOrder(orderId);
    return {
      success: true,
      data: phases,
    };
  }

  // 更新阶段状态
  @Put('phases/:phaseId/status')
  async updatePhaseStatus(
    @Param('phaseId') phaseId: string,
    @Body() dto: UpdatePhaseStatusDto,
  ) {
    const phase = await this.executionService.updatePhaseStatus(phaseId, dto);
    return {
      success: true,
      data: phase,
    };
  }

  // 更新子任务状态
  @Put('sub-tasks/:subTaskId/status')
  async updateSubTaskStatus(
    @Param('subTaskId') subTaskId: string,
    @Body() dto: UpdateSubTaskStatusDto,
  ) {
    const subTask = await this.executionService.updateSubTaskStatus(
      subTaskId,
      dto,
    );
    return {
      success: true,
      data: subTask,
    };
  }

  // 上报进度（通用接口，各组件调用）
  @Post('progress/report')
  async reportProgress(@Body() dto: ReportProgressDto) {
    await this.executionService.reportProgress(dto);
    return {
      success: true,
      message: 'Progress reported successfully',
    };
  }

  // 添加子任务日志
  @Post('sub-tasks/:subTaskId/logs')
  async addSubTaskLog(
    @Param('subTaskId') subTaskId: string,
    @Body() dto: AddLogDto,
  ) {
    await this.executionService.addSubTaskLog(subTaskId, dto);
    return {
      success: true,
      message: 'Log added successfully',
    };
  }

  // 获取阶段的子任务
  @Get('phases/:phaseId/sub-tasks')
  async getSubTasksByPhase(@Param('phaseId') phaseId: string) {
    const subTasks = await this.executionService.getSubTasksByPhase(phaseId);
    return {
      success: true,
      data: subTasks,
    };
  }

  // 重试执行任务（调用 openclaw-bridge 重新执行）
  @Post('orders/:orderId/retry')
  async retryExecution(@Param('orderId') orderId: string) {
    const result = await this.executionService.retryExecution(orderId);
    return {
      success: true,
      data: result,
    };
  }
}
