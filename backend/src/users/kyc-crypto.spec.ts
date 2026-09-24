import { encryptIdCard, decryptIdCard, maskIdCard } from './kyc-crypto';

describe('kyc-crypto', () => {
  it('encrypt 后 decrypt 可还原且密文不含明文', () => {
    const plain = '110101199003078888';
    const blob = encryptIdCard(plain);
    expect(blob).toBeTruthy();
    expect(blob).not.toContain(plain);
    expect(decryptIdCard(blob)).toBe(plain);
  });

  it('两次加密密文不同（随机 IV）', () => {
    const plain = '11010119900307001X';
    expect(encryptIdCard(plain)).not.toBe(encryptIdCard(plain));
  });

  it('maskIdCard 脱敏', () => {
    expect(maskIdCard('11010119900307001X')).toBe('110***********001X');
    expect(maskIdCard('110101199003077001')).toBe('110***********7001');
    expect(maskIdCard('abc')).toBe('***');
  });
});