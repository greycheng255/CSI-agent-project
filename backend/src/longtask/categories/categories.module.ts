import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from './category.entity';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { AdminCategoriesController } from './admin-categories.controller';

/**
 * 平台类目树模块（PRD §4.5 / §4.1）。
 *
 * - 公开只读：GET /api/v1/categories（active 树）、GET /api/v1/categories/full（全量树）
 * - 超管 CRUD：POST/PATCH/DELETE /api/v1/admin/categories
 * - 校验能力导出：供 MarketplaceTasksService / WorkspacesService 注入调用
 * - 启动时幂等预置根类目（ensureSeed）
 *
 * 纯叶子模块，无外部模块依赖；被 LongtaskModule 与 AdminModule 引用。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Category])],
  controllers: [CategoriesController, AdminCategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule implements OnModuleInit {
  constructor(private readonly categoriesService: CategoriesService) {}

  async onModuleInit() {
    await this.categoriesService.ensureSeed();
  }
}
