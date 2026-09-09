import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SuperAdminGuard } from '../../admin/admin.guard';
import { CategoriesService } from './categories.service';
import { CategoryStatsService } from './category-stats.service';
import { MatchScoreService } from './match-score.service';
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from './categories.service';

/**
 * 平台类目体系超管 CRUD + 运营报表 + 匹配阈值配置
 * （PRD §185「管理平台类目体系」+ §5.1 阈值可调 + 阶段二运营报表）。
 *
 * 路由前缀 /api/v1/admin/categories，全部经 SuperAdminGuard 守卫。
 *
 * 类目 CRUD：
 * - POST   /                 新建（slug 全局唯一；parentId 非空时校验存在）
 * - PATCH  /:id              更新（部分字段；parentId 变更走环检测）
 * - DELETE /:id              删除（有子节点禁止；建议改用 PATCH isActive=false 软下架）
 * - GET    /                 全量树（含 inactive）
 * - GET    /:id               单节点详情
 *
 * 阶段二运营报表：
 * - GET    /report           全量类目运营报表（任务/投递/竞标/订单/平均匹配度）
 * - GET    /:id/stats         单类目详细统计（含任务状态分布）
 *
 * 匹配度阈值配置（PRD §410 平台管理员可在后台调整）：
 * - GET    /match-threshold   读取当前阈值
 * - PUT    /match-threshold   运行时调整阈值
 */
@Controller('api/v1/admin/categories')
@UseGuards(SuperAdminGuard)
export class AdminCategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly statsService: CategoryStatsService,
    private readonly matchScoreService: MatchScoreService,
  ) {}

  // —— 运营报表（先声明，避免被 :id 路由吞掉） ——

  /** 全量类目运营报表（阶段二） */
  @Get('report')
  report() {
    return this.statsService.getReport();
  }

  /** 读取当前匹配度投递阈值（PRD §410） */
  @Get('match-threshold')
  getThreshold() {
    return { threshold: this.matchScoreService.getThreshold() };
  }

  /** 运行时调整匹配度投递阈值（PRD §410） */
  @Patch('match-threshold')
  setThreshold(@Body() body: { threshold: number }) {
    this.matchScoreService.setThreshold(body.threshold);
    return { threshold: this.matchScoreService.getThreshold() };
  }

  // —— 类目 CRUD ——

  @Get()
  tree() {
    return this.categoriesService.getFullTree();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.categoriesService.findById(id);
  }

  /** 单类目详细统计（含任务状态分布，阶段二「类目运营报表」） */
  @Get(':id/stats')
  stats(@Param('id') id: string) {
    return this.statsService.getStats(id);
  }

  @Post()
  create(@Body() body: CreateCategoryInput) {
    return this.categoriesService.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateCategoryInput) {
    return this.categoriesService.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.categoriesService.remove(id);
    return { message: 'deleted', id };
  }
}
