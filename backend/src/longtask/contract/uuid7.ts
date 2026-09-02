import { randomBytes } from 'crypto';

/**
 * UUID v7 生成（对接指南 §3.1 通用请求头：X-Request-Id / Idempotency-Key 取 uuid-v7）。
 * 48bit 毫秒时间戳 + version 7 + variant 10 + 62bit 随机，单调性不保证（无需严格递增）。
 */
export function uuidv7(now = Date.now()): string {
  const buf = Buffer.alloc(16);
  buf.writeUInt32BE(Math.floor(now / 2 ** 16), 0);
  buf.writeUInt16BE(now % 2 ** 16, 4);
  randomBytes(10).copy(buf, 6);
  buf[6] = 0x70 | (buf[6] & 0x0f); // version 7
  buf[8] = 0x80 | (buf[8] & 0x3f); // variant 10
  const hex = buf.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
