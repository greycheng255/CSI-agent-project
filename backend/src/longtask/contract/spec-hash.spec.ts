import { canonicalize, computeSpecHash } from './spec-hash';

describe('spec-hash（未决项 #1：canonical JSON + SHA-256 默认口径）', () => {
  it('canonicalize：对象键递归排序，与插入顺序无关', () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });

  it('canonicalize：数组保序、无空白', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('canonicalize：基础类型与 null/undefined 归一', () => {
    expect(canonicalize('x')).toBe('"x"');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(undefined)).toBe('null');
  });

  it('computeSpecHash：相同内容不同键序 → 同一哈希', () => {
    const a = computeSpecHash({ summary: 'x', items: [{ k: 1, j: 2 }] });
    const b = computeSpecHash({ items: [{ j: 2, k: 1 }], summary: 'x' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
