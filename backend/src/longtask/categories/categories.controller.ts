import { Controller, Get } from '@nestjs/common';
import { CategoriesService } from './categories.service';

/**
 * 类目树公开只读 API（PRD §4.5 / §4.1「从平台类目树中选择」）。
 *
 * - GET /api/v1/categories        仅 active 节点的树（任务发布页/Workspace 引导配置消费）
 * - GET /api/v1/categories/full   全量树（含 inactive，超管后台用，无额外鉴权要求：
 *                                 公测期后台同进程；正式版走 /api/v1/admin/categories）
 *
 * 树结构在内存层组装（节点量级 ≤ 千，公测期可接受）。
 */
@Controller('api/v1/categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

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
}
