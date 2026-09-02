import { createHmac, timingSafeEqual } from 'crypto';

/**
 * HMAC-SHA256 签名与校验（对接指南 §3.1）：
 * X-Signature: t=<unix_ts>,v1=<hmac_sha256(body 原文 + ts)>
 * 编码显式规定为 hex（64 位小写，TS L1770 2026-09-02 澄清注记；GitHub/Stripe webhook 行业惯例）。
 * 接收方验证：Bearer 比对 → timestamp 偏差 ≤ 5min → nonce 唯一 → HMAC 重算。
 */

/** 计算签名（body 原文 + 时间戳），输出 hex */
export function signPayload(payload: string, ts: number, secret: string): string {
  return createHmac('sha256', secret).update(payload + ts).digest('hex');
}

/**
 * 请求 payload 原文派生（§3.1，2026-09-02 Console 复测澄清）：
 * - rawBody 优先取真原文（Buffer/string），避免 re-serialization 差异（如 Go JSON HTML 转义 \u003c）
 * - 无 body 请求（GET/DELETE）契约语义 = 空串；仅当请求真有 JSON body 且解析结果非空时才回退 re-serialization
 */
export function deriveRawPayload(input: {
  rawBody?: string | Buffer | undefined;
  body?: unknown;
}): string {
  if (Buffer.isBuffer(input.rawBody)) return input.rawBody.toString('utf8');
  if (typeof input.rawBody === 'string') return input.rawBody;
  const body = input.body;
  return body && typeof body === 'object' && Object.keys(body).length > 0
    ? JSON.stringify(body)
    : '';
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