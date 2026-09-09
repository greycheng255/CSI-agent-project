import { MatchScoreService } from './match-score.service';
import { MarketplaceTask } from '../marketplace-tasks/marketplace-task.entity';
import { Workspace } from '../workspaces/workspace.entity';

/**
 * MatchScoreService 单元测试（PRD §5.1 模式一匹配度评分）。
 *
 * 评分模型（满分 100）：
 *   类目重合度     40
 *   标签语义匹配   30（Jaccard，无标签时中性 15）
 *   历史完成率     15（无历史时中性 7.5；有完成全部 15）
 *   雇主评分       15（无评分中性 7.5；按比例 0-15）
 *
 * 阈值默认 60；冷启动 30 天内保底通过。
 */
describe('MatchScoreService', () => {
  let service: MatchScoreService;
  let tasksRepo: { manager: any };
  let bidsRepo: any;
  let ordersRepo: any;

  beforeEach(() => {
    tasksRepo = { manager: { findOne: jest.fn(), findByIds: jest.fn() } };
    bidsRepo = {};
    ordersRepo = {};
    service = new MatchScoreService(
      tasksRepo as any,
      bidsRepo as any,
      ordersRepo as any,
    );
  });

  function makeTask(overrides: Partial<MarketplaceTask> = {}): MarketplaceTask {
    return {
      id: 't1',
      title: '任务',
      categoryId: 'cat-1',
      tags: ['前端', 'react'],
      status: 'open',
      seatLimit: 20,
      seatTaken: 0,
      bidRound: 1,
      expiresAt: null,
      seatFullDeadline: null,
      seatFullLockedAt: null,
      lastReopenedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as MarketplaceTask;
  }

  function makeWs(overrides: Partial<Workspace> = {}): Workspace {
    return {
      id: 'w1',
      name: 'AI 工作室',
      slug: 'studio-a',
      categoryIds: ['cat-1'],
      capabilityTags: ['前端', 'react'],
      displayStatus: 'active',
      receivePlatformPush: true,
      completedTasksCount: 0,
      avgRating: 0,
      createdAt: new Date(),
      ...overrides,
    } as Workspace;
  }

  describe('computeScore', () => {
    it('完美匹配：类目重叠+标签全中+有完成+满分评分 → 接近满分', () => {
      const task = makeTask({ tags: ['前端', 'react'] });
      const ws = makeWs({
        categoryIds: ['cat-1'],
        capabilityTags: ['前端', 'react'],
        completedTasksCount: 5,
        avgRating: 5,
      });
      const score = service.computeScore(task, ws);
      // 40(类目) + 30(Jaccard=1.0×30) + 15(完成) + 15(评分5/5×15) = 100
      expect(score).toBe(100);
    });

    it('类目不匹配 → 类目分 0；总分降低', () => {
      const task = makeTask({ categoryId: 'cat-x' });
      const ws = makeWs({
        categoryIds: ['cat-1'],
        capabilityTags: ['前端', 'react'],
        completedTasksCount: 5,
        avgRating: 5,
      });
      const score = service.computeScore(task, ws);
      // 0(类目) + 30(标签) + 15(完成) + 15(评分) = 60
      expect(score).toBe(60);
    });

    it('标签部分匹配（Jaccard=0.5）→ 标签分 15', () => {
      const task = makeTask({ tags: ['前端', 'vue'] });
      const ws = makeWs({
        categoryIds: ['cat-1'],
        capabilityTags: ['前端', 'react'],
        completedTasksCount: 0,
        avgRating: 0,
      });
      const score = service.computeScore(task, ws);
      // 40(类目) + 15(Jaccard=1/3×30=10) + 7.5(完成中性) + 7.5(评分中性)
      // 实际 Jaccard: 交集{前端}=1, 并集{前端,vue,react}=3, 1/3×30=10
      // 40+10+7.5+7.5 = 65
      expect(score).toBe(65);
    });

    it('任务无标签 → 标签中性分 15', () => {
      const task = makeTask({ tags: null });
      const ws = makeWs({
        categoryIds: ['cat-1'],
        capabilityTags: ['前端'],
        completedTasksCount: 0,
        avgRating: 0,
      });
      const score = service.computeScore(task, ws);
      // 40 + 15(中性) + 7.5 + 7.5 = 70
      expect(score).toBe(70);
    });

    it('Workspace 无 capabilityTags → 标签中性分 15', () => {
      const task = makeTask({ tags: ['前端'] });
      const ws = makeWs({
        categoryIds: ['cat-1'],
        capabilityTags: null,
        completedTasksCount: 0,
        avgRating: 0,
      });
      const score = service.computeScore(task, ws);
      // 40 + 15 + 7.5 + 7.5 = 70
      expect(score).toBe(70);
    });

    it('评分按比例（avg_rating=3 → 评分分 9）', () => {
      const task = makeTask({ tags: ['前端', 'react'] });
      const ws = makeWs({
        categoryIds: ['cat-1'],
        capabilityTags: ['前端', 'react'],
        completedTasksCount: 5,
        avgRating: 3,
      });
      const score = service.computeScore(task, ws);
      // 40 + 30 + 15 + (3/5×15=9) = 94
      expect(score).toBe(94);
    });

    it('分数限定 [0, 100]', () => {
      const task = makeTask({ categoryId: 'cat-x', tags: null });
      const ws = makeWs({
        categoryIds: [],
        capabilityTags: null,
        completedTasksCount: 0,
        avgRating: 0,
      });
      const score = service.computeScore(task, ws);
      // 0(类目) + 15(中性) + 7.5 + 7.5 = 30
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('shouldDeliver（阈值过滤）', () => {
    it('分数 ≥ 阈值 → 投递', () => {
      const ws = makeWs({ createdAt: new Date('2020-01-01') }); // 非冷启动
      expect(service.shouldDeliver(80, ws)).toBe(true);
    });

    it('分数 < 阈值 且非冷启动 → 不投递', () => {
      const ws = makeWs({ createdAt: new Date('2020-01-01') });
      expect(service.shouldDeliver(50, ws)).toBe(false);
    });

    it('分数 < 阈值 但在冷启动期 → 保底投递', () => {
      const ws = makeWs({ createdAt: new Date() }); // 刚创建
      expect(service.shouldDeliver(30, ws)).toBe(true);
    });

    it('无 createdAt 不视为冷启动', () => {
      const ws = makeWs({ createdAt: null as any });
      expect(service.shouldDeliver(30, ws)).toBe(false);
    });
  });

  describe('阈值配置（PRD §410）', () => {
    it('默认阈值 60', () => {
      expect(service.getThreshold()).toBe(60);
    });

    it('setThreshold 调整后生效', () => {
      service.setThreshold(75);
      expect(service.getThreshold()).toBe(75);
    });

    it('非法阈值（<0 / >100 / NaN）→ 抛错', () => {
      expect(() => service.setThreshold(-1)).toThrow();
      expect(() => service.setThreshold(101)).toThrow();
      expect(() => service.setThreshold(NaN)).toThrow();
    });
  });

  describe('evaluate（组合方法）', () => {
    it('返回 score + deliver 一致', () => {
      const task = makeTask({ tags: ['前端', 'react'] });
      const ws = makeWs({
        categoryIds: ['cat-1'],
        capabilityTags: ['前端', 'react'],
        completedTasksCount: 5,
        avgRating: 5,
        createdAt: new Date('2020-01-01'),
      });
      const { score, deliver } = service.evaluate(task, ws);
      expect(score).toBe(100);
      expect(deliver).toBe(true);
    });
  });
});
