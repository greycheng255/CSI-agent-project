import { createHmac, timingSafeEqual } from 'crypto';

/**
 * HMAC-SHA256 签名与校验（对接指南 §3.1）：
 * X-Signature: t=<unix_ts>,v1=<hmac_sha256(body 原文 + ts)>
 * 接收方验证：Bearer 比对 → timestamp 偏差 ≤ 5min → nonce 唯一 → HMAC 重算。
 */

/** 计算签名（body 原文 + 时间戳） */
export function signPayload(payload: string, ts: number, secret: string): string {
  return createHmac('sha256', secret).update(payload + ts).digest('base64');
}

/** 解析 X-Signature 头，格式非法返回 null */
export function parseSignature(
  header: string | undefined | null,
): { ts: number; v1: string } | null {
  if (!header) return null;
  const tsMatch = header.match(/(?:^|,)\s*t=(\d+)/);
  const v1Match = header.match(/(?:^|,)\s*v1=([^,\s]+)/);
  if (!tsMatch || !v1Match) return null;
  return { ts: Number.parseInt(tsMatch[1], 10), v1: v1Match[1] };
}

/** 常量时间比较校验签名 */
export function verifySignature(
  payload: string,
  ts: number,
  signature: string,
  secret: string,
): boolean {
  const expected = signPayload(payload, ts, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 时间戳新鲜度校验（默认 5 分钟漂移窗口） */
export function isTimestampFresh(
  ts: number,
  nowSeconds = Math.floor(Date.now() / 1000),
  maxDriftSeconds = 300,
): boolean {
  return Math.abs(nowSeconds - ts) <= maxDriftSeconds;
}