import {
  deriveRawPayload,
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

  it('签名输出为 hex（64 位小写，TS L1770 编码澄清）', () => {
    const sig = signPayload('{"a":1}', 1_700_000_000, secret);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('与独立 hex 计算交叉一致（对齐 Console signer 口径）', () => {
    const { createHmac } = require('crypto');
    const ts = 1_700_000_000;
    const expected = createHmac('sha256', secret).update('{"a":1}' + ts).digest('hex');
    expect(signPayload('{"a":1}', ts, secret)).toBe(expected);
    expect(verifySignature('{"a":1}', ts, expected, secret)).toBe(true);
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

describe('deriveRawPayload（§3.1 body 原文派生，2026-09-02 Console 复测澄清）', () => {
  it('GET 无 body → 空串（契约语义，而非 "{}"）', () => {
    expect(deriveRawPayload({})).toBe('');
    expect(deriveRawPayload({ body: {} })).toBe('');
    expect(deriveRawPayload({ body: undefined })).toBe('');
  });

  it('rawBody Buffer/string 优先取真原文', () => {
    const raw = '{"a":1,"b":"<x>"}';
    expect(deriveRawPayload({ rawBody: Buffer.from(raw), body: { a: 1 } })).toBe(raw);
    expect(deriveRawPayload({ rawBody: raw, body: { a: 1 } })).toBe(raw);
  });

  it('rawBody 缺失但有非空 JSON body → 回退 re-serialization', () => {
    expect(deriveRawPayload({ body: { a: 1 } })).toBe('{"a":1}');
  });

  it('与空串签名往返一致（GET pull 口径）', () => {
    const sig = signPayload('', 1_700_000_000, 's');
    expect(verifySignature('', 1_700_000_000, sig, 's')).toBe(true);
    expect(verifySignature('{}', 1_700_000_000, sig, 's')).toBe(false);
  });
});