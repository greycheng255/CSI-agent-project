#!/usr/bin/env node
/**
 * Console 契约替身（联调窗口 P0 #5/#6 前置自测工具）。
 *
 * 模拟 Console 侧 17 个 M→C Webhook 接收端（对接指南 §3.1/§3.4/§4.1）：
 * - 验证 Bearer LONGTASK_SERVICE_TOKEN + X-Signature（HMAC-SHA256(body 原文 + ts)）
 * - 按 (event_id, event_type) 幂等去重：重复投递返回 200 且不重复记录
 * - 故障注入：目标 URL 加 ?fail=500（可重试）/ ?fail=404（死信）/ ?fail=timeout（网络错误）
 * - 收到的 webhook 存内存，GET /__received 查看快照
 *
 * 用法：
 *   LONGTASK_SERVICE_TOKEN=st-local node scripts/mock-console.mjs [port]
 * 默认端口 8800；平台侧将 CONSOLE_BASE_URL 指向 http://localhost:8800。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? 8800);
const TOKEN = process.env.LONGTASK_SERVICE_TOKEN ?? 'st-local';
const MAX_DRIFT_SECONDS = 300;

/** 17 个 Console Webhook 端点（backend/src/longtask/contract/console-endpoints.ts 同步维护） */
const WEBHOOK_PATHS = [
  '/v1/webhooks/opportunity/pushed',
  '/v1/webhooks/bid/result',
  '/v1/webhooks/task/employer-reply',
  '/v1/webhooks/spec/employer-action',
  '/v1/webhooks/delivery/employer-review',
  '/v1/webhooks/revision/negotiation-action',
  '/v1/webhooks/spec-change/request',
  '/v1/webhooks/spec-change/employer-confirmation',
  '/v1/webhooks/project/cancel-request',
  '/v1/webhooks/project/cancel-counter-response',
  '/v1/webhooks/project/cancel-resolution',
  '/v1/webhooks/settlement/result',
  '/v1/webhooks/project/dispute-raised',
  '/v1/webhooks/settlement/appeal-period-closed',
  '/v1/webhooks/dispute/arbitration-started',
  '/v1/webhooks/dispute/arbitration-result',
];

const received = [];
const seenIds = new Set();

function verifyHmac(rawBody, header) {
  const tsMatch = String(header ?? '').match(/(?:^|,)\s*t=(\d+)/);
  const v1Match = String(header ?? '').match(/(?:^|,)\s*v1=([^,\s]+)/);
  if (!tsMatch || !v1Match) return false;
  const ts = Number.parseInt(tsMatch[1], 10);
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > MAX_DRIFT_SECONDS) return false;
  const expected = createHmac('sha256', TOKEN).update(rawBody + ts).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(v1Match[1]);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/__received') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: received.length, items: received }, null, 2));
    return;
  }

  if (req.method !== 'POST' || !WEBHOOK_PATHS.includes(url.pathname)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unknown webhook path', path: url.pathname }));
    return;
  }

  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    // 故障注入（联调重试/死信链路用）
    const fail = url.searchParams.get('fail');
    if (fail === 'timeout') return; // 不响应 → 平台 10s 超时按网络错误重试
    if (fail === '500' || fail === '404') {
      res.writeHead(Number(fail), { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ title: `injected ${fail}` }));
      return;
    }

    const auth = req.headers['authorization'] ?? '';
    if (auth.replace(/^Bearer\s+/i, '').trim() !== TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ title: 'AUTH_TOKEN_INVALID' }));
      return;
    }
    if (!verifyHmac(raw, req.headers['x-signature'])) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ title: 'AUTH_HMAC_SIGNATURE_MISMATCH' }));
      return;
    }

    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      /* 保持空对象 */
    }
    const eventId = body.event_id ?? body.eventId ?? '(missing)';
    const eventType = body.event_type ?? body.eventType ?? '(missing)';
    const duplicate = seenIds.has(`${eventId}|${eventType}`);
    if (!duplicate) {
      seenIds.add(`${eventId}|${eventType}`);
      received.push({ at: new Date().toISOString(), path: url.pathname, event_id: eventId, event_type: eventType, body });
      console.log(`[mock-console] ✓ ${eventType} event_id=${eventId} → ${url.pathname}`);
    } else {
      console.log(`[mock-console] ↺ duplicate ${eventType} event_id=${eventId}（幂等 ACK）`);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, duplicate }));
  });
});

server.listen(PORT, () => {
  console.log(`[mock-console] Console 契约替身已启动: http://localhost:${PORT}`);
  console.log(`[mock-console] Token: ${TOKEN}；故障注入: ?fail=500|404|timeout；查看快照: GET /__received`);
});
