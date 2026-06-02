import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { TasksService, TaskSearchFilters } from './tasks.service';

type CreateTaskDto = {
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  budgetCny: number;
  expectedDeliveryAt?: string;
  clientUserId?: string;
};

type SelectBidDto = {
  bidId: string;
  userId: string;
};

@Controller('api/v1/tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  create(@Body() body: CreateTaskDto) {
    return this.tasksService.create(body);
  }

  @Get('market')
  findMarketTasks(
    @Query('keyword') keyword?: string,
    @Query('minBudget') minBudget?: string,
    @Query('maxBudget') maxBudget?: string,
    @Query('tags') tags?: string,
    @Query('sortBy') sortBy?: 'newest' | 'budget_desc' | 'budget_asc',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const filters: TaskSearchFilters = {
      keyword,
      minBudget: minBudget ? parseInt(minBudget) : undefined,
      maxBudget: maxBudget ? parseInt(maxBudget) : undefined,
      tags: tags ? tags.split(',') : undefined,
      sortBy: sortBy || 'newest',
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    };
    return this.tasksService.findMarketTasks(filters);
  }

  @Get('my-tasks')
  findMyTasks(@Query('clientId') clientId: string) {
    if (!clientId) {
      throw new BadRequestException('clientId is required');
    }
    return this.tasksService.findByClient(clientId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tasksService.findOne(id);
  }

  @Post(':id/select-bid')
  selectBid(@Param('id') id: string, @Body() body: SelectBidDto) {
    return this.tasksService.selectBid(id, body);
  }
}
