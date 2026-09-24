import {
  CreditOrderFact,
  computeWorkspaceCredit,
  creditSummaryOf,
  deliveryOutcomeRating,
  isOnTimeDelivery,
} from './credit-scoring';

const base: CreditOrderFact = {
  orderId: 'o',
  deliveryStatus: 'accepted',
  hasDispute: false,
  expectedDeliveryAt: new Date('2026-09-10T00:00:00Z'),
  firstSubmittedAt: new Date('2026-09-08T00:00:00Z'),
  firstDeliveryStatus: 'accepted',
  hadRevisionRequest: false,
  lastDeliveryStatus: 'accepted',
};

describe('credit-scoring 信用数据口径（PRD §5.6.7）', () => {
  it('空事实集 → 四项全 0（不产生 NaN）', () => {
    expect(computeWorkspaceCredit([])).toEqual({
      completedTasksCount: 0,
      avgRating: 0,
      onTimeRate: 0,
      disputeRate: 0,
    });
  });

  it('首次交付即通过 → 5.0；经修订后通过 → 3.5；最终驳回 → 1.0', () => {
    expect(deliveryOutcomeRating(base)).toBe(5);
    expect(
      deliveryOutcomeRating({
        ...base,
        firstDeliveryStatus: 'revision_requested',
        hadRevisionRequest: true,
      }),
    ).toBe(3.5);
    expect(
      deliveryOutcomeRating({ ...base, lastDeliveryStatus: 'rejected' }),
    ).toBe(1);
  });

  it('未验收订单（in_accept）不可评价 → null，不计入平均分', () => {
    expect(
      deliveryOutcomeRating({ ...base, deliveryStatus: 'in_accept' }),
    ).toBeNull();
  });

  it('按时交付：首次交付提交时间 ≤ 期望交付时间才算按时', () => {
    expect(isOnTimeDelivery(base)).toBe(true);
    expect(
      isOnTimeDelivery({
        ...base,
        firstSubmittedAt: new Date('2026-09-11T00:00:00Z'),
      }),
    ).toBe(false);
    // 任务未设期望交付时间 / 无交付记录 → 不计入分母
    expect(isOnTimeDelivery({ ...base, expectedDeliveryAt: null })).toBeNull();
    expect(isOnTimeDelivery({ ...base, firstSubmittedAt: null })).toBeNull();
  });

  it('聚合四项：完成数、平均评分、按时交付率、纠纷率', () => {
    const facts: CreditOrderFact[] = [
      base, // 首次通过 + 按时
      {
        ...base,
        orderId: 'o2',
        firstDeliveryStatus: 'revision_requested',
        hadRevisionRequest: true,
        firstSubmittedAt: new Date('2026-09-12T00:00:00Z'), // 逾期
      },
      {
        // 未验收但已有纠纷 → 计入纠纷率分母，不计入完成数/评分
        ...base,
        orderId: 'o3',
        deliveryStatus: 'in_accept',
        hasDispute: true,
        firstDeliveryStatus: 'submitted',
      },
    ];
    expect(computeWorkspaceCredit(facts)).toEqual({
      completedTasksCount: 2,
      avgRating: 4.25, // (5 + 3.5) / 2
      onTimeRate: 0.5, // 1/2
      disputeRate: 0.3333, // 1/3
    });
  });

  it('已完成订单全部无期望交付时间 → 按时交付率为 0（非 NaN）', () => {
    const credit = computeWorkspaceCredit([
      { ...base, expectedDeliveryAt: null },
    ]);
    expect(credit.completedTasksCount).toBe(1);
    expect(credit.onTimeRate).toBe(0);
  });

  it('无任何已完成订单 → 完成数与评分归 0，纠纷率仍按全部订单算', () => {
    const credit = computeWorkspaceCredit([
      { ...base, deliveryStatus: 'in_accept', hasDispute: false },
      { ...base, deliveryStatus: 'in_accept', hasDispute: true },
    ]);
    expect(credit).toEqual({
      completedTasksCount: 0,
      avgRating: 0,
      onTimeRate: 0,
      disputeRate: 0.5,
    });
  });

  it('creditSummaryOf 归一化 pg numeric 字符串返回值', () => {
    expect(
      creditSummaryOf({
        completedTasksCount: 12,
        avgRating: '4.70',
        onTimeRate: '0.9300',
        disputeRate: '0.0200',
      }),
    ).toEqual({
      completedTasksCount: 12,
      avgRating: 4.7,
      onTimeRate: 0.93,
      disputeRate: 0.02,
    });
    expect(creditSummaryOf({})).toEqual({
      completedTasksCount: 0,
      avgRating: 0,
      onTimeRate: 0,
      disputeRate: 0,
    });
  });
});