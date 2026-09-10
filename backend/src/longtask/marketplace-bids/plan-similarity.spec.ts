import {
  evaluatePlanSimilarity,
  planSimilarity,
  SIMILARITY_WARN_THRESHOLD,
} from './plan-similarity';

describe('plan-similarity（PRD §5.6.8 差异化软警告）', () => {
  it('完全相同方案 → 相似度 1 且触发警告', () => {
    const plan = '我们将采用 Vue3 + Node 完成官网开发，含响应式与接口联调。';
    const r = evaluatePlanSimilarity(plan, [plan]);
    expect(r.maxSimilarity).toBeCloseTo(1, 4);
    expect(r.similarCount).toBe(1);
    expect(r.warning).toBe(true);
    expect(r.threshold).toBe(SIMILARITY_WARN_THRESHOLD);
  });

  it('差异明显的方案 → 不触发警告', () => {
    const r = evaluatePlanSimilarity('用 Go 写一个高并发网关服务', [
      '采用 Vue3 完成企业官网首页与产品页，含响应式设计',
    ]);
    expect(r.warning).toBe(false);
  });

  it('无已提交方案 / 方案为空 → 不触发警告', () => {
    expect(evaluatePlanSimilarity('任意方案', []).warning).toBe(false);
    expect(evaluatePlanSimilarity('  ', ['任意方案']).warning).toBe(false);
    expect(evaluatePlanSimilarity(null, ['任意方案']).warning).toBe(false);
  });

  it('多个近似方案 → 统计 similarCount', () => {
    const base = '提供 Web 站点开发全流程，含设计、开发、联调与上线验收。';
    const r = evaluatePlanSimilarity(base, [base, base + ' 追加说明', '完全不同：数据分析报告']);
    expect(r.similarCount).toBeGreaterThanOrEqual(2);
    expect(r.warning).toBe(true);
  });

  it('planSimilarity：空串返回 0', () => {
    expect(planSimilarity('', 'abc')).toBe(0);
  });
});
