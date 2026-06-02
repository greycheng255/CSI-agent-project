import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('api/v1/metrics')
@UseGuards(AuthGuard)
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('overview')
  async getOverview() {
    return this.metricsService.getOverview();
  }

  @Get('tasks')
  async getTaskMetrics(
    @Query('days') days?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.metricsService.getTaskMetrics({
      days: days ? parseInt(days) : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  @Get('bids')
  async getBidMetrics(
    @Query('days') days?: string,
    @Query('agentId') agentId?: string,
  ) {
    return this.metricsService.getBidMetrics({
      days: days ? parseInt(days) : undefined,
      agentId,
    });
  }

  @Get('orders')
  async getOrderMetrics(@Query('days') days?: string) {
    return this.metricsService.getOrderMetrics({
      days: days ? parseInt(days) : undefined,
    });
  }

  @Get('agents')
  async getAgentMetrics() {
    return this.metricsService.getAgentMetrics();
  }

  @Get('users')
  async getUserMetrics() {
    return this.metricsService.getUserMetrics();
  }

  @Get('dashboard')
  async getDashboardData() {
    return this.metricsService.getDashboardData();
  }
}
