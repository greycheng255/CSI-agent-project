import { computeWorkspaceCredit } from '../workspaces/credit-scoring';
import {
  CREDIT_WEIGHTS,
  INDUSTRY_AVG_RATING,
  RECOMMEND_WEIGHTS,
  scoreWorkspaceRecommendation,
} from './recommend-scoring';

/** 信用数据样例：与展示页口径一致（完成任务 12 / 评分 4.7 / 按时 93% / 纠纷 2%） */
const strongCredit = {
  completedTasksCount: 12,
  avgRating: 4.7,
  onTimeRate: 0.93,
  disputeRate: 0.02,
};

describe('recommend-scoring 平台推荐工作室推荐分', () => {
  it('权重口径：类目 0.4 + 标签 0.2 + 信用 0.4', () => {
    expect(RECOMMEND_WEIGHTS).toEqual({ category: 0.4, tags: 0.2, credit: 0.4 });
    expect(CREDIT_WEIGHTS).toEqual({ rating: 0.5, onTime: 0.3, completed: 0.2 });
  });

  it('类目匹配 + 高信用 → 94.52 分取整 95（无标签任务不惩罚）', () => {
    const result = scoreWorkspaceRecommendation({
      categoryId: 'cat-web',
      taskTags: [],
      workspace: { categoryIds: ['cat-web'], capabilityTags: [], credit: strongCredit },
    });
    // credit = 0.5*0.94 + 0.3*0.93 + 0.2*0.6 - 0.3*0.02 = 0.863
    expect(result.creditScore).toBeCloseTo(0.863, 3);
    expect(result.score).toBe(95);
    expect(result.breakdown).toEqual({ category: 100, tags: 100, credit: 86 });
    expect(result.reasons).toContain('已完成 12 单');
    expect(result.reasons).toContain('平均评分 4.7/5');
    expect(result.reasons).toContain('按时交付率 93%');
    // disputeRate=0.02 → 不满足「无纠纷记录」文案条件
    expect(result.reasons).not.toContain('无纠纷记录');
  });

  it('纠纷率按 0.3 权重扣分；零纠纷才给「无纠纷记录」理由', () => {
    const clean = scoreWorkspaceRecommendation({
      categoryId: 'cat-web',
      workspace: {
        categoryIds: ['cat-web'],
        credit: { ...strongCredit, disputeRate: 0 },
      },
    });
    const disputed = scoreWorkspaceRecommendation({
      categoryId: 'cat-web',
      workspace: { categoryIds: ['cat-web'], credit: { ...strongCredit, disputeRate: 1 } },
    });
    expect(clean.creditScore).toBeCloseTo(0.869, 3); // 0.47+0.279+0.12-0
    expect(disputed.creditScore).toBeCloseTo(0.569, 3); // 同口径再扣 0.3
    expect(clean.creditScore - disputed.creditScore).toBeCloseTo(0.3, 5);
    expect(disputed.score).toBe(83);
    expect(clean.reasons).toContain('无纠纷记录');
    expect(disputed.reasons).not.toContain('无纠纷记录');
  });

  it('信用分下限钳到 0（不出现负分拉低类目匹配）', () => {
    const result = scoreWorkspaceRecommendation({
      categoryId: 'cat-web',
      taskTags: [],
      workspace: {
        categoryIds: ['cat-web'],
        credit: {
          completedTasksCount: 5,
          avgRating: 0,
          onTimeRate: 0,
          disputeRate: 1,
        },
      },
    });
    expect(result.creditScore).toBe(0);
    expect(result.score).toBe(60); // 0.4 + 0.2 tags满分
  });

  it('新店（历史 < 3 单）评分维度按行业均分兜底并给出理由', () => {
    const result = scoreWorkspaceRecommendation({
      categoryId: 'cat-web',
      workspace: {
        categoryIds: ['cat-web'],
        credit: { completedTasksCount: 0, avgRating: 0, onTimeRate: 0, disputeRate: 0 },
      },
    });
    expect(INDUSTRY_AVG_RATING).toBe(3.5);
    expect(result.newShop).toBe(true);
    expect(result.creditScore).toBeCloseTo(0.35, 5);
    expect(result.score).toBe(74);
    expect(result.reasons.some((r) => r.startsWith('新店'))).toBe(true);
  });

  it('能力标签用词集 Jaccard，部分重合按比例得分并给理由', () => {
    const result = scoreWorkspaceRecommendation({
      categoryId: 'cat-web',
      taskTags: ['react', 'typescript'],
      workspace: {
        categoryIds: ['cat-web'],
        capabilityTags: ['react', 'node'],
        credit: strongCredit,
      },
    });
    // Jaccard = 1/3
    expect(result.breakdown.tags).toBe(33);
    expect(result.reasons).toContain('能力标签匹配度 33%');
  });

  it('排序语义：同信用水平下类目匹配严格优先', () => {
    const matched = scoreWorkspaceRecommendation({
      categoryId: 'cat-web',
      taskTags: [],
      workspace: { categoryIds: ['cat-web'], credit: strongCredit },
    });
    const unmatched = scoreWorkspaceRecommendation({
      categoryId: 'cat-web',
      taskTags: [],
      workspace: { categoryIds: ['cat-data'], credit: strongCredit },
    });
    expect(matched.score).toBeGreaterThan(unmatched.score);
    expect(unmatched.reasons).not.toContain('经营类目匹配：cat-web');
  });

  it('冷启动（入驻 30 天内）给出平台保底推荐理由', () => {
    const nowMs = new Date('2026-09-24T00:00:00Z').getTime();
    const result = scoreWorkspaceRecommendation(
      {
        categoryId: 'cat-web',
        workspace: {
          categoryIds: ['cat-web'],
          createdAt: '2026-09-10T00:00:00Z',
          credit: computeWorkspaceCredit([]),
        },
      },
      { nowMs },
    );
    expect(result.coldStart).toBe(true);
    expect(result.reasons).toContain('新入驻 30 天内（平台保底推荐）');
  });
});