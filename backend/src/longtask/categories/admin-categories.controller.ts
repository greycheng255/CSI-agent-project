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
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from './categories.service';

/**
 * 平台类目体系超管 CRUD（PRD §185「管理平台类目体系」是平台运营方职责）。
 *
 * 路由前缀 /api/v1/admin/categories，全部经 SuperAdminGuard 守卫。
 *
 * - POST   /          新建（slug 全局唯一；parentId 非空时校验存在）
 * - PATCH  /:id       更新（部分字段；parentId 变更走环检测）
 * - DELETE /:id       删除（有子节点禁止；建议改用 PATCH isActive=false 软下架）
 * - GET    /          全量树（含 inactive）
 * - GET    /:id       单节点详情
 */
@Controller('api/v1/admin/categories')
@UseGuards(SuperAdminGuard)
export class AdminCategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  tree() {
    return this.categoriesService.getFullTree();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.categoriesService.findById(id);
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
