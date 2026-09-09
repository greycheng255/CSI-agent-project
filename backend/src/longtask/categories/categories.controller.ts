import { Controller, Get, Param } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoryStatsService } from './category-stats.service';

/**
 * 类目树公开只读 API（PRD §4.5 / §4.1「从平台类目树中选择」）。
 *
 * - GET /api/v1/categories                 仅 active 节点的树（任务发布页/Workspace 引导配置消费）
 * - GET /api/v1/categories/full            全量树（含 inactive，超管后台用）
 * - GET /api/v1/categories/:id/task-count  单类目任务计数（含 open_count，公开任务大厅标签消费）
 *
 * 树结构在内存层组装（节点量级 ≤ 千，公测期可接受）。
 */
@Controller('api/v1/categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly statsService: CategoryStatsService,
  ) {}

  /** 公开类目树（仅 active + is_leaf 标记） */
  @Get()
  tree() {
    return this.categoriesService.getTree();
  }

  /** 全量树（含 inactive，便于超管后台展示与编辑） */
  @Get('full')
  fullTree() {
    return this.categoriesService.getFullTree();
  }

  /**
   * 单类目任务计数（阶段二「类目下任务计数」）。
   * 公开数据（任务数本身是公开的），用于任务大厅类目标签展示。
   */
  @Get(':id/task-count')
  taskCount(@Param('id') id: string) {
    return this.statsService.getTaskCount(id);
  }
}
