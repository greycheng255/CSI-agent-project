import {
  MATCH_WEIGHTS,
  scoreWorkspaceMatch,
  tagSetSimilarity,
} from './match-scoring';

describe('match-scoring（PRD §5.1 匹配度 + 冷启动保底）', () => {
  const oldWorkspace = {
    categoryIds: ['web'],
    capabilityTags: ['Web 网站开发', 'SaaS 官网'],
    completedTasksCount: 8,
    avgRating: 4.6,
    createdAt: new Date('2025-01-01T00:00:00Z'),
  };
  const nowMs = new Date('2026-09-10T00:00:00Z').getTime();

  it('类目命中 + 标签重合 + 高信用 → 高分通过', () => {
    const r = scoreWorkspaceMatch(
      {
        categoryId: 'web',
        taskTags: ['Web 网站开发'],
        workspace: oldWorkspace,
      },
      { nowMs },
    );
    expect(MATCH_WEIGHTS.category).toBe(0.5);
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.passed).toBe(true);
    expect(r.coldStart).toBe(false);
  });

  it('类目不命中 → 低分不通过（非冷启动）', () => {
    const r = scoreWorkspaceMatch(
      {
        categoryId: 'report',
        taskTags: ['数据分析报告'],
        workspace: oldWorkspace,
      },
      { nowMs },
    );
    expect(r.breakdown.category).toBe(0);
    expect(r.passed).toBe(false);
  });

  it('新 Workspace（入驻 <30 天）→ 冷启动保底放行', () => {
    const r = scoreWorkspaceMatch(
      {
        categoryId: 'report',
        taskTags: [],
        workspace: {
          ...oldWorkspace,
          categoryIds: [],
          createdAt: new Date('2026-09-01T00:00:00Z'),
        },
      },
      { nowMs },
    );
    expect(r.coldStart).toBe(true);
    expect(r.passed).toBe(true);
  });

  it('任务无标签 → 标签维度不惩罚', () => {
    const r = scoreWorkspaceMatch(
      { categoryId: 'web', taskTags: null, workspace: { ...oldWorkspace, capabilityTags: [] } },
      { nowMs },
    );
    expect(r.breakdown.tags).toBe(100);
  });

  it('阈值可配（threshold=95 时 90 分不通过）', () => {
    const r = scoreWorkspaceMatch(
      { categoryId: 'web', taskTags: ['Web 网站开发'], workspace: oldWorkspace },
      { threshold: 99, nowMs, coldStartDays: 0 },
    );
    expect(r.passed).toBe(false);
  });

  it('tagSetSimilarity：任一侧为空返回 null', () => {
    expect(tagSetSimilarity([], ['a'])).toBeNull();
    expect(tagSetSimilarity(['A'], ['a'])).toBe(1);
    expect(tagSetSimilarity(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3, 4);
  });
});
