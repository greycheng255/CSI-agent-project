import {
  isTimestampFresh,
  parseSignature,
  signPayload,
  verifySignature,
} from './hmac-sign';

describe('hmac-sign（契约 §3.1）', () => {
  const secret = 'test-secret';

  it('签名-验签往返一致', () => {
    const ts = 1_700_000_000;
    const sig = signPayload('{"a":1}', ts, secret);
    expect(verifySignature('{"a":1}', ts, sig, secret)).toBe(true);
  });

  it('篡改 body 后验签失败', () => {
    const ts = 1_700_000_000;
    const sig = signPayload('{"a":1}', ts, secret);
    expect(verifySignature('{"a":2}', ts, sig, secret)).toBe(false);
  });

  it('时间戳不同则签名不同', () => {
    const sig1 = signPayload('body', 1_700_000_000, secret);
    const sig2 = signPayload('body', 1_700_000_001, secret);
    expect(sig1).not.toBe(sig2);
  });

  it('parseSignature 解析 t 与 v1', () => {
    expect(parseSignature('t=1700000000,v1=abc')).toEqual({
      ts: 1_700_000_000,
      v1: 'abc',
    });
    expect(parseSignature('t=1700000000, v1=abc=def')).toEqual({
      ts: 1_700_000_000,
      v1: 'abc=def',
    });
  });

  it('parseSignature 非法格式返回 null', () => {
    expect(parseSignature(undefined)).toBeNull();
    expect(parseSignature('v1=abc')).toBeNull();
    expect(parseSignature('t=abc,v1=abc')).toBeNull();
  });

  it('时间戳漂移窗口默认 5 分钟', () => {
    const now = 1_700_000_000;
    expect(isTimestampFresh(now, now)).toBe(true);
    expect(isTimestampFresh(now + 299, now)).toBe(true);
    expect(isTimestampFresh(now + 301, now)).toBe(false);
    expect(isTimestampFresh(now - 301, now)).toBe(false);
  });
});