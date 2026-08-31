import {
  isWeightsSumValid,
  settlementAmount,
} from './milestone-math';

describe('milestone-math（T20：里程碑结算公式）', () => {
  it('权重和=100% 校验', () => {
    expect(
      isWeightsSumValid([
        { key: 'm1', weight: 0.4 },
        { key: 'm2', weight: 0.6 },
      ]),
    ).toBe(true);
    expect(isWeightsSumValid([{ weight: 0.4 }])).toBe(false);
    expect(isWeightsSumValid([{ weight: 1.1 }])).toBe(false);
    expect(isWeightsSumValid([])).toBe(true); // 无里程碑不校验
  });

  it('仅 verified_passed 里程碑计入结算', () => {
    const milestones = [
      { key: 'm1', weight: 0.4, status: 'verified_passed' },
      { key: 'm2', weight: 0.6, status: 'pending' },
    ];
    // 0.4 × 10000 = 4000
    expect(settlementAmount(milestones, 10_000)).toBe(4_000);
  });

  it('全部通过 → 全额结算', () => {
    const milestones = [
      { weight: 0.3, status: 'verified_passed' },
      { weight: 0.7, status: 'verified_passed' },
    ];
    expect(settlementAmount(milestones, 10_000)).toBe(10_000);
  });

  it('无可结算里程碑 → 0（转纠纷路径）', () => {
    expect(
      settlementAmount(
        [{ weight: 1, status: 'pending' }],
        10_000,
      ),
    ).toBe(0);
    expect(settlementAmount([], 10_000)).toBe(0);
    expect(settlementAmount([], 0)).toBe(0);
  });
});