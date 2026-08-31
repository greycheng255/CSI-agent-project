import {
  compositeScore,
  freshnessScore,
  median,
  normalizedRating,
  priceScore,
} from './bid-scoring';

const base = {
  avgRating: 4.5,
  industryAvgRating: 3.5,
  completedTasksCount: 10,
  priceCny: 800,
  medianPriceCny: 1000,
  submittedAtMs: 1_000_000,
  nowMs: 1_000_000,
};

describe('bid-scoring（T11：综合分公式 PRD §5.6.1）', () => {
  it('中位数计算（奇数/偶数/空）', () => {
    expect(median([800, 1000, 1200])).toBe(1000);
    expect(median([800, 1200])).toBe(1000);
    expect(median([])).toBe(0);
  });

  it('评分归一化：老店用自身评分', () => {
    expect(normalizedRating(base)).toBeCloseTo(0.9, 5);
  });

  it('评分归一化：历史订单 < 3 取行业平均分（新店兜底）', () => {
    expect(
      normalizedRating({ ...base, avgRating: 1, completedTasksCount: 1, industryAvgRating: 3.5 }),
    ).toBeCloseTo(0.7, 5);
  });

  it('报价性价比：(中位 - 报价)/中位', () => {
    expect(priceScore(800, 1000)).toBeCloseTo(0.2, 5);
    expect(priceScore(1200, 1000)).toBeCloseTo(-0.2, 5);
  });

  it('恶意低价（低于中位 50%）反向扣分', () => {
    expect(priceScore(400, 1000)).toBe(-1);
    expect(priceScore(500, 1000)).toBe(-1);
  });

  it('时效：24h 内满分，72h 衰减到 0', () => {
    expect(freshnessScore(1_000_000, 1_000_000)).toBe(1);
    expect(
      freshnessScore(1_000_000, 1_000_000 + 24 * 3_600_000),
    ).toBeCloseTo(1, 5);
    expect(
      freshnessScore(1_000_000, 1_000_000 + 72 * 3_600_000),
    ).toBeCloseTo(0, 5);
    expect(
      freshnessScore(1_000_000, 1_000_000 + 100 * 3_600_000),
    ).toBe(0);
  });

  it('综合分 = 0.4 评分 + 0.3 性价比 + 0.3 时效', () => {
    const score = compositeScore(base);
    const expected = 0.4 * 0.9 + 0.3 * 0.2 + 0.3 * 1;
    expect(score).toBeCloseTo(expected, 5);
  });
});