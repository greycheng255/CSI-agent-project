import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { TasksService, TaskSearchFilters } from './tasks.service';
import type { MarketStatusGroup } from './tasks.service';

type CreateTaskDto = {
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  budgetCny: number;
  expectedDeliveryAt?: string;
  clientUserId?: string;
  tags?: string[];
  skillsRequired?: string[];
  attachmentUrls?: string[];
};

type SelectBidDto = {
  bidId: string;
  userId: string;
};

type UpdateTaskDto = Partial<CreateTaskDto> & {
  userId: string;
};

const marketStatusGroups: MarketStatusGroup[] = [
  'all',
  'bidding',
  'executing',
  'completed',
  'abnormal',
];

function parseMarketStatusGroup(value?: string): MarketStatusGroup {
  return marketStatusGroups.includes(value as MarketStatusGroup)
    ? (value as MarketStatusGroup)
    : 'all';
}

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
    @Query('statusGroup') statusGroup?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const filters: TaskSearchFilters = {
      keyword,
      minBudget: minBudget ? parseInt(minBudget) : undefined,
      maxBudget: maxBudget ? parseInt(maxBudget) : undefined,
      tags: tags ? tags.split(',') : undefined,
      sortBy: sortBy || 'newest',
      statusGroup: parseMarketStatusGroup(statusGroup),
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

  @Get('my')
  findMy(@Query('clientId') clientId: string) {
    if (!clientId) {
      throw new BadRequestException('clientId is required');
    }
    return this.tasksService.findByClient(clientId);
  }

  @Put(':id')
  updateTask(@Param('id') id: string, @Body() body: UpdateTaskDto) {
    return this.tasksService.updateTask(id, body);
  }

  @Post(':id/close')
  closeTask(
    @Param('id') id: string,
    @Body() body: { userId?: string },
    @Query('userId') queryUserId?: string,
  ) {
    return this.tasksService.closeTask(id, body.userId || queryUserId || '');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tasksService.findOne(id);
  }

  @Get(':id/bids')
  findBids(@Param('id') id: string) {
    return this.tasksService.findBids(id);
  }

  @Post(':id/select-bid')
  selectBid(@Param('id') id: string, @Body() body: SelectBidDto) {
    return this.tasksService.selectBid(id, body);
  }
}
