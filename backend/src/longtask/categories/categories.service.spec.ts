import { CategoriesService } from './categories.service';
import { Category } from './category.entity';
import { ContractError } from '../contract/errors';

/**
 * CategoriesService 单元测试（PRD §4.5 / §4.1 平台类目树）。
 *
 * 覆盖：
 * - getTree / getFullTree：内存层组装 + is_leaf 计算
 * - validateLeafActive：必填/存在/叶子/active 四类约束
 * - validateActiveBatch：批量 + 去重 + 不存在/未激活
 * - create / update / remove：slug 唯一、循环引用、有子节点删除、下架挂空
 * - ensureSeed：幂等预置
 */
describe('CategoriesService', () => {
  let service: CategoriesService;
  let repo: {
    findOne: jest.Mock;
    find: jest.Mock;
    findByIds: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      find: jest.fn(async () => []),
      findByIds: jest.fn(async () => []),
      save: jest.fn(async (v) => v),
      create: jest.fn((v) => v),
      delete: jest.fn(async () => ({ affected: 1 })),
    };
    service = new CategoriesService(repo as any);
  });

  function makeCat(overrides: Partial<Category> = {}): Category {
    return {
      id: 'cat-1',
      parentId: null,
      name: '软件开发',
      slug: 'development',
      sortOrder: 10,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as Category;
  }

  describe('getTree / getFullTree', () => {
    it('组装两层树并标记 is_leaf（叶子无子节点）', async () => {
      const root = makeCat({ id: 'root', parentId: null });
      const child = makeCat({
        id: 'child',
        parentId: 'root',
        name: '前端',
        slug: 'frontend',
      });
      repo.find.mockResolvedValue([root, child]);
      const tree = await service.getTree();
      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe('root');
      expect(tree[0].is_leaf).toBe(false);
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].is_leaf).toBe(true);
    });

    it('getTree 仅返回 active 节点（inactive 不在结果中）', async () => {
      // getTree 调用时传 where: { isActive: true }，mock 应模拟 DB 已按 where 过滤
      const active = makeCat({ id: 'a', parentId: null });
      repo.find.mockResolvedValue([active]);
      const tree = await service.getTree();
      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe('a');
      expect(repo.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
    });

    it('getFullTree 含 inactive 节点', async () => {
      const active = makeCat({ id: 'a', parentId: null });
      const inactive = makeCat({
        id: 'i',
        parentId: null,
        isActive: false,
      });
      repo.find.mockResolvedValue([active, inactive]);
      const tree = await service.getFullTree();
      expect(tree).toHaveLength(2);
    });
  });

  describe('validateLeafActive（任务发布侧）', () => {
    it('必填且传入 null → 400', async () => {
      await expect(service.validateLeafActive(null, true)).rejects.toMatchObject({
        status: 400,
      });
    });

    it('必填且传入空字符串 → 400', async () => {
      await expect(
        service.validateLeafActive('', true),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('可选且未传 → 跳过校验（返回 null）', async () => {
      await expect(
        service.validateLeafActive(null, false),
      ).resolves.toBeNull();
    });

    it('类目不存在 → 404', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.validateLeafActive('missing', true),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('类目未激活 → 400', async () => {
      repo.findOne.mockResolvedValue(makeCat({ isActive: false }));
      await expect(
        service.validateLeafActive('cat-1', true),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('非叶子（有子节点）→ 400', async () => {
      repo.findOne.mockResolvedValue(makeCat({})); // 自身存在
      repo.findOne.mockResolvedValueOnce(makeCat({})); // 第一次调用：自身
      repo.findOne.mockResolvedValueOnce(makeCat({ id: 'child' })); // hasChildren：有子
      await expect(
        service.validateLeafActive('cat-1', true),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('叶子且 active → 通过', async () => {
      repo.findOne.mockResolvedValueOnce(makeCat({})); // 自身
      repo.findOne.mockResolvedValueOnce(null); // hasChildren：无子
      await expect(
        service.validateLeafActive('cat-1', true),
      ).resolves.toBeTruthy();
    });
  });

  describe('validateActiveBatch（Workspace 引导配置侧）', () => {
    it('空数组且非必填 → 返回空', async () => {
      await expect(
        service.validateActiveBatch([], { required: false }),
      ).resolves.toEqual([]);
    });

    it('空数组且必填 → 400', async () => {
      await expect(
        service.validateActiveBatch(null, { required: true }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('超出上限 → 400', async () => {
      const ids = Array.from({ length: 11 }, (_, i) => `c${i}`);
      await expect(
        service.validateActiveBatch(ids, { max: 10 }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('去重后落库', async () => {
      repo.findByIds.mockResolvedValue([
        makeCat({ id: 'c1' }),
        makeCat({ id: 'c2' }),
      ]);
      const result = await service.validateActiveBatch(['c1', 'c2', 'c1']);
      expect(result).toEqual(['c1', 'c2']);
    });

    it('部分不存在 → 404', async () => {
      repo.findByIds.mockResolvedValue([makeCat({ id: 'c1' })]);
      await expect(
        service.validateActiveBatch(['c1', 'missing']),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('部分未激活 → 400', async () => {
      repo.findByIds.mockResolvedValue([
        makeCat({ id: 'c1' }),
        makeCat({ id: 'c2', isActive: false }),
      ]);
      await expect(
        service.validateActiveBatch(['c1', 'c2']),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('create', () => {
    it('slug 格式非法（含大写/空格）→ 400', async () => {
      await expect(
        service.create({ name: 'x', slug: 'Bad Slug' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('name 为空 → 400', async () => {
      await expect(
        service.create({ name: '', slug: 'valid-slug' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('parentId 不存在 → 404', async () => {
      repo.findOne.mockResolvedValue(null); // parent 不存在
      await expect(
        service.create({
          name: '子类目',
          slug: 'child',
          parentId: 'missing-parent',
        }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('slug 已存在 → 409', async () => {
      repo.findOne.mockResolvedValue(makeCat({})); // slug 已存在
      await expect(
        service.create({ name: '重复', slug: 'development' }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('合法创建 → 落库', async () => {
      repo.findOne.mockResolvedValue(null); // slug 不存在
      const created = await service.create({
        name: '新类目',
        slug: 'new-cat',
        sortOrder: 5,
      });
      expect(created.slug).toBe('new-cat');
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('类目不存在 → 404', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.update('missing', { name: 'x' })).rejects.toMatchObject({
        status: 404,
      });
    });

    it('slug 变更且与他人冲突 → 409', async () => {
      repo.findOne.mockResolvedValueOnce(makeCat({ id: 'cat-1', slug: 'a' })); // 自身
      repo.findOne.mockResolvedValueOnce(makeCat({ id: 'cat-2', slug: 'b' })); // 冲突
      await expect(
        service.update('cat-1', { slug: 'b' }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('parentId 等于自身 → 400（自引用）', async () => {
      repo.findOne.mockResolvedValue(makeCat({ id: 'cat-1' }));
      await expect(
        service.update('cat-1', { parentId: 'cat-1' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('下架时存在 active 子节点 → 400', async () => {
      repo.findOne.mockResolvedValueOnce(makeCat({ id: 'cat-1' })); // 自身
      repo.findOne.mockResolvedValueOnce(makeCat({ id: 'child' })); // 有 active 子
      await expect(
        service.update('cat-1', { isActive: false }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('移动到自己的子孙 → 400（环）', async () => {
      // 自身 cat-1，要把 parentId 改成 cat-2，而 cat-2 是 cat-1 的子孙
      repo.findOne
        .mockResolvedValueOnce(makeCat({ id: 'cat-1', parentId: null })) // 自身
        .mockResolvedValueOnce(makeCat({ id: 'cat-2', parentId: 'cat-1' })) // 新父存在
        .mockResolvedValueOnce(makeCat({ id: 'cat-2', parentId: 'cat-1' })); // isDescendantOf 起点
      // isDescendantOf 从 cat-2 沿 parentId 爬：cat-2.parentId=cat-1 === ancestorId=cat-1 → true
      await expect(
        service.update('cat-1', { parentId: 'cat-2' }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('remove', () => {
    it('类目不存在 → 404', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.remove('missing')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('有子节点 → 400', async () => {
      repo.findOne.mockResolvedValueOnce(makeCat({ id: 'cat-1' }));
      repo.findOne.mockResolvedValueOnce(makeCat({ id: 'child' })); // hasChildren
      await expect(service.remove('cat-1')).rejects.toMatchObject({
        status: 400,
      });
    });

    it('叶子节点 → 删除成功', async () => {
      repo.findOne.mockResolvedValueOnce(makeCat({ id: 'cat-1' }));
      repo.findOne.mockResolvedValueOnce(null); // hasChildren=false
      await expect(service.remove('cat-1')).resolves.toBeUndefined();
      expect(repo.delete).toHaveBeenCalledWith('cat-1');
    });
  });

  describe('ensureSeed', () => {
    it('已存在的 slug 跳过（幂等）', async () => {
      repo.findOne.mockResolvedValue(makeCat({ slug: 'development' })); // 已存在
      await service.ensureSeed();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('不存在的 slug → 创建', async () => {
      repo.findOne.mockResolvedValue(null); // 全部不存在
      await service.ensureSeed();
      // 至少创建了若干根类目
      expect(repo.save.mock.calls.length).toBeGreaterThan(0);
    });

    it('save 抛错时跳过（不阻塞启动）', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.save.mockRejectedValue(new Error('unique constraint'));
      await expect(service.ensureSeed()).resolves.toBeUndefined();
    });
  });
});
