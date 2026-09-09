import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from './category.entity';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { AdminCategoriesController } from './admin-categories.controller';
import { CategoryStatsService } from './category-stats.service';
import { MatchScoreService } from './match-score.service';
import { MarketplaceTask } from '../marketplace-tasks/marketplace-task.entity';
import { MarketplaceBid } from '../marketplace-bids/marketplace-bid.entity';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { OpportunityDispatch } from '../marketplace-tasks/opportunity-dispatch.entity';

/**
 * 平台类目树模块（PRD §4.5 / §4.1）。
 *
 * - 公开只读：GET /api/v1/categories（active 树）、GET /api/v1/categories/full（全量树）
 * - 超管 CRUD：POST/PATCH/DELETE /api/v1/admin/categories
 * - 校验能力导出：供 MarketplaceTasksService / WorkspacesService 注入调用
 * - 启动时幂等预置根类目（ensureSeed）
 *
 * 阶段二新增：
 * - MatchScoreService：PRD §5.1 匹配度评分（导出给 OpportunityPushService）
 * - CategoryStatsService：类目下任务计数 + 运营报表
 * - 公开任务计数 API + 超管报表 API
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Category,
      MarketplaceTask,
      MarketplaceBid,
      MarketplaceOrder,
      OpportunityDispatch,
    ]),
  ],
  controllers: [CategoriesController, AdminCategoriesController],
  providers: [CategoriesService, CategoryStatsService, MatchScoreService],
  exports: [CategoriesService, MatchScoreService],
})
export class CategoriesModule implements OnModuleInit {
  constructor(private readonly categoriesService: CategoriesService) {}

  async onModuleInit() {
    await this.categoriesService.ensureSeed();
  }
}
