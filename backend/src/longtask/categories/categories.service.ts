import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './category.entity';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';

/** 公开类目树节点（GET /api/v1/categories 返回结构） */
export interface CategoryTreeNode {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
  is_leaf: boolean;
  children: CategoryTreeNode[];
}

/** 超管创建类目入参 */
export interface CreateCategoryInput {
  parentId?: string | null;
  name: string;
  slug: string;
  sortOrder?: number;
  isActive?: boolean;
}

/** 超管更新类目入参（部分字段可选） */
export interface UpdateCategoryInput {
  name?: string;
  slug?: string;
  sortOrder?: number;
  isActive?: boolean;
  parentId?: string | null;
}

/**
 * 平台类目树服务（PRD §4.5 / §4.1）。
 *
 * 职责：
 * - 公开只读树查询（含 is_leaf 标记，前端按叶子类目发布任务）
 * - 超管 CRUD（含 slug 唯一约束、循环引用防护、有子节点禁止删除）
 * - 校验工具：供 MarketplaceTasksService / WorkspacesService 调用
 *   - validateLeafActive(categoryId)：任务发布侧
 *   - validateActiveBatch(categoryIds)：Workspace 引导配置侧
 * - 启动时幂等预置根类目（开发/设计/运营/数据分析...，详见 ensureSeed）
 */
@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    @InjectRepository(Category)
    private readonly repo: Repository<Category>,
  ) {}

  /**
   * 公开类目树（仅 active 节点；按 sort_order、name 排序）。
   * is_leaf 字段在内存层计算（无子节点即为叶子）。
   */
  async getTree(): Promise<CategoryTreeNode[]> {
    const all = await this.repo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return this.buildTree(all, null);
  }

  /** 全量树（含 inactive，超管后台用） */
  async getFullTree(): Promise<CategoryTreeNode[]> {
    const all = await this.repo.find({
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return this.buildTree(all, null);
  }

  private buildTree(all: Category[], parentId: string | null): CategoryTreeNode[] {
    return all
      .filter((c) => (c.parentId ?? null) === parentId)
      .map((c) => {
        const children = this.buildTree(all, c.id);
        return {
          id: c.id,
          parent_id: c.parentId,
          name: c.name,
          slug: c.slug,
          sort_order: c.sortOrder,
          is_active: c.isActive,
          is_leaf: children.length === 0,
          children,
        };
      });
  }

  /** 按主键查询 */
  findById(id: string): Promise<Category | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** 按 slug 查询（唯一约束兜底） */
  findBySlug(slug: string): Promise<Category | null> {
    return this.repo.findOne({ where: { slug } });
  }

  /** 该节点是否有子节点（用于 is_leaf 判定与删除约束） */
  hasChildren(id: string): Promise<boolean> {
    return this.repo
      .findOne({ where: { parentId: id } })
      .then((c) => !!c);
  }

  /**
   * 校验类目可作为任务发布类目：
   * - 必填（非空）
   * - 存在
   * - 叶子节点（无子节点）
   * - active（未下架）
   *
   * @param categoryId 被校验的类目 id（可能为 null/undefined）
   * @param required 是否必填；默认 true。false 时仅当传入非空值才校验
   */
  async validateLeafActive(
    categoryId: string | null | undefined,
    required = true,
  ): Promise<Category> {
    if (!categoryId) {
      if (required) {
        throw new ContractError(
          400,
          CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
          'categoryId is required',
        );
      }
      // 可选且未传 → 跳过
      return null as unknown as Category;
    }
    const cat = await this.findById(categoryId);
    if (!cat) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_TASK,
        `category not found: ${categoryId}`,
      );
    }
    if (!cat.isActive) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        `category is not active: ${categoryId}`,
      );
    }
    if (await this.hasChildren(categoryId)) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        `category is not a leaf (has children): ${categoryId}`,
      );
    }
    return cat;
  }

  /**
   * 批量校验 Workspace 引导配置的 categoryIds：
   * - 每个元素存在 + active（不强制叶子，Workspace 可经营父类目下的全树）
   * - 去重
   * - 元素数量上限保护
   */
  async validateActiveBatch(
    categoryIds: string[] | null | undefined,
    opts: { max?: number; required?: boolean } = {},
  ): Promise<string[]> {
    const { max = 10, required = false } = opts;
    if (!categoryIds || categoryIds.length === 0) {
      if (required) {
        throw new ContractError(
          400,
          CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
          'categoryIds is required',
        );
      }
      return [];
    }
    if (categoryIds.length > max) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        `categoryIds must not exceed ${max} items`,
      );
    }
    const uniq = [...new Set(categoryIds.filter(Boolean))];
    const rows = await this.repo.findByIds(uniq);
    const found = new Set(rows.map((r) => r.id));
    const missing = uniq.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_TASK,
        `categories not found: ${missing.join(',')}`,
      );
    }
    const inactive = rows.filter((r) => !r.isActive).map((r) => r.id);
    if (inactive.length > 0) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        `categories not active: ${inactive.join(',')}`,
      );
    }
    return uniq;
  }

  /**
   * 超管：创建类目。
   * - slug 全局唯一（前置查询 + DB 唯一约束兜底）
   * - parentId 非空时校验存在（不强制 active，便于建层级后再启用）
   * - 不允许循环引用（创建时 parentId 不能等于自己，理论不会发生但防御）
   */
  async create(input: CreateCategoryInput): Promise<Category> {
    this.validateSlug(input.slug);
    this.validateName(input.name);
    if (input.parentId !== null && input.parentId !== undefined) {
      const parent = await this.findById(input.parentId);
      if (!parent) {
        throw new ContractError(
          404,
          CONTRACT_ERROR_CODE.NOT_FOUND_TASK,
          `parent category not found: ${input.parentId}`,
        );
      }
    }
    const existsSlug = await this.findBySlug(input.slug);
    if (existsSlug) {
      throw new ContractError(
        409,
        CONTRACT_ERROR_CODE.CONFLICT_DUPLICATE,
        `category slug already exists: ${input.slug}`,
      );
    }
    const entity = this.repo.create({
      parentId: input.parentId ?? null,
      name: input.name,
      slug: input.slug,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    });
    return this.repo.save(entity);
  }

  /**
   * 超管：更新类目（部分字段）。
   * - slug 变更时校验全局唯一（排除自身）
   * - parentId 变更时校验：新父存在 + 不能等于自身（自引用）+ 不能是自己的子孙（环）
   * - 任意字段都不允许把 is_active=false 但仍存在 active 子节点（造成"挂空"）
   */
  async update(id: string, input: UpdateCategoryInput): Promise<Category> {
    const cat = await this.findById(id);
    if (!cat) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_TASK,
        `category not found: ${id}`,
      );
    }

    if (input.name !== undefined) {
      this.validateName(input.name);
      cat.name = input.name;
    }
    if (input.slug !== undefined) {
      this.validateSlug(input.slug);
      if (input.slug !== cat.slug) {
        const dup = await this.findBySlug(input.slug);
        if (dup && dup.id !== cat.id) {
          throw new ContractError(
            409,
            CONTRACT_ERROR_CODE.CONFLICT_DUPLICATE,
            `category slug already exists: ${input.slug}`,
          );
        }
      }
      cat.slug = input.slug;
    }
    if (input.sortOrder !== undefined) {
      cat.sortOrder = input.sortOrder;
    }
    if (input.isActive !== undefined) {
      // 下架前检查：若有 active 子节点，禁止下架（避免"挂空"）
      if (input.isActive === false) {
        const child = await this.repo.findOne({
          where: { parentId: id, isActive: true },
        });
        if (child) {
          throw new ContractError(
            400,
            CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
            `cannot deactivate category with active children: ${id}`,
          );
        }
      }
      cat.isActive = input.isActive;
    }
    if (input.parentId !== undefined) {
      const newParentId = input.parentId ?? null;
      // 不能把自己挂到自己下面
      if (newParentId === id) {
        throw new ContractError(
          400,
          CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
          'category parentId cannot equal id (self reference)',
        );
      }
      // 父必须存在
      if (newParentId !== null) {
        const parent = await this.findById(newParentId);
        if (!parent) {
          throw new ContractError(
            404,
            CONTRACT_ERROR_CODE.NOT_FOUND_TASK,
            `parent category not found: ${newParentId}`,
          );
        }
        // 环检测：newParentId 不能是当前节点的子孙
        if (await this.isDescendantOf(newParentId, id)) {
          throw new ContractError(
            400,
            CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
            `cannot move category under its own descendant: ${newParentId}`,
          );
        }
      }
      cat.parentId = newParentId;
    }

    return this.repo.save(cat);
  }

  /**
   * 超管：删除类目。
   * - 有子节点禁止删除（先删子）
   * - 软删除方案：删除前提示存在引用（任务/Workspace）
   *   公测期采用物理删除（仅超管后台，且通常类目是 inactive 而非删除）
   */
  async remove(id: string): Promise<void> {
    const cat = await this.findById(id);
    if (!cat) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_TASK,
        `category not found: ${id}`,
      );
    }
    if (await this.hasChildren(id)) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        `cannot delete category with children: ${id}`,
      );
    }
    await this.repo.delete(id);
  }

  /**
   * 启动时幂等预置根类目（PRD §4.5「从平台类目树中选择」）。
   * 已存在 slug 跳过，幂等。公测期最小集，正式版由超管后台维护。
   */
  async ensureSeed(): Promise<void> {
    const seed: Array<{ slug: string; name: string; sortOrder: number }> = [
      { slug: 'development', name: '软件开发', sortOrder: 10 },
      { slug: 'design', name: '设计', sortOrder: 20 },
      { slug: 'operation', name: '运营', sortOrder: 30 },
      { slug: 'data-analysis', name: '数据分析', sortOrder: 40 },
      { slug: 'content', name: '内容创作', sortOrder: 50 },
      { slug: 'marketing', name: '营销推广', sortOrder: 60 },
    ];
    for (const item of seed) {
      const existing = await this.findBySlug(item.slug);
      if (existing) continue;
      try {
        await this.repo.save(
          this.repo.create({
            parentId: null,
            name: item.name,
            slug: item.slug,
            sortOrder: item.sortOrder,
            isActive: true,
          }),
        );
        this.logger.log(`Seed category created: ${item.slug}`);
      } catch (err) {
        // 并发或重复时跳过
        this.logger.warn(
          `Seed category skipped: ${item.slug} | ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * 判断 targetId 是否是 ancestorId 的子孙（环检测用）。
   * 从 targetId 沿 parentId 向上爬，若遇到 ancestorId 返回 true。
   */
  private async isDescendantOf(
    targetId: string,
    ancestorId: string,
  ): Promise<boolean> {
    let current: Category | null = await this.findById(targetId);
    const visited = new Set<string>();
    while (current && current.parentId) {
      if (visited.has(current.id)) break; // 防御性环跳出
      visited.add(current.id);
      if (current.parentId === ancestorId) return true;
      current = await this.findById(current.parentId);
    }
    return false;
  }

  private validateName(name: string): void {
    if (!name || name.trim().length === 0 || name.length > 128) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        'category name must be 1-128 chars',
      );
    }
  }

  private validateSlug(slug: string): void {
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 128) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        'category slug must be lowercase kebab-case (1-128 chars)',
      );
    }
  }
}
