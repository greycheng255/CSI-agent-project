#!/usr/bin/env node
/**
 * Marketplace 接收侧替身（C→M 联调验证 Console 侧发送方代码逻辑）。
 *
 * 与 scripts/mock-console.mjs 对称：mock-console 是 M→C 接收替身（验证平台
 * 发送方），本脚本是 C→M 接收替身（验证 Console 发送方）。复刻：
 *   - backend/src/longtask/contract/hmac.guard.ts 四道验签
 *     （Bearer → ts≤5min → nonce 唯一 → HMAC 重算；rawBody 优先，无 body=空串）
 *   - backend/src/longtask/contract/marketplace-contract.controller.ts 路由
 *     （GET /v1/marketplace/tasks、POST /tasks/:id/bids、PATCH /orders/:id、
 *      POST /orders/:id/spec、/deliverables、/settlement/trigger 等）
 *   - backend/src/longtask/contract/rfc7807.filter.ts 错误渲染
 *
 * 用法：
 *   # 仅起接收替身（Console 团队用真实发送方代码打过来）
 *   LONGTASK_INBOUND_TOKEN=c2m-secret node scripts/mock-marketplace.mjs [port]
 *
 *   # 自测：起替身 + 内置发送方对它发请求，验证签名构造与验签骨架
 *   LONGTASK_INBOUND_TOKEN=c2m-secret node scripts/mock-marketplace.mjs --selftest
 *
 * 默认端口 8801（避免与 mock-console.mjs 的 8800 冲突）。
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const TOKEN = process.env.LONGTASK_INBOUND_TOKEN ?? process.env.LONGTASK_SERVICE_TOKEN ?? 'c2m-secret';
// 联调对齐（2026-09-04 代理抓包）：Console 服务级调用 Bearer 与 HMAC 可用不同
// 密钥。设 LONGTASK_INBOUND_HMAC_SECRET 时 HMAC 重算优先用该密钥，回落 INBOUND。
const HMAC_SECRET = process.env.LONGTASK_INBOUND_HMAC_SECRET || TOKEN;
const MAX_DRIFT_SECONDS = 300;
const NONCE_TTL_MS = 10 * 60 * 1000;
const PORT = process.argv[2] === '--selftest' ? 8801 : Number(process.argv[2] ?? 8801);
const SELFTEST = process.argv.includes('--selftest');

/**
 * 复刻 backend/src/longtask/contract/hmac-sign.ts（同口径，保持签名两端一致）：
 *   X-Signature: t=<unix_ts>,v1=<hmac_sha256(body 原文 + ts)>  (hex)
 */
function signPayload(payload, ts, secret) {
  return createHmac('sha256', secret).update(payload + ts).digest('hex');
}

function parseSignature(header) {
  const tsMatch = String(header ?? '').match(/(?:^|,)\s*t=(\d+)/);
  const v1Match = String(header ?? '').match(/(?:^|,)\s*v1=([^,\s]+)/);
  if (!tsMatch || !v1Match) return null;
  return { ts: Number.parseInt(tsMatch[1], 10), v1: v1Match[1] };
}

function isTimestampFresh(ts, nowSeconds, maxDrift) {
  return Math.abs(nowSeconds - ts) <= maxDrift;
}

function verifySignature(payload, ts, signature, secret) {
  const expected = signPayload(payload, ts, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 派生请求 payload 原文（§3.1，与 hmac-sign.ts deriveRawPayload 同口径）：
 * - rawBody 优先取真原文，避免 re-serialization 差异
 * - 无 body 请求（GET/DELETE）契约语义 = 空串；仅当真有 JSON body 且非空才回退
 */
function deriveRawPayload(rawBody, body) {
  if (Buffer.isBuffer(rawBody)) return rawBody.toString('utf8');
  if (typeof rawBody === 'string') return rawBody;
  return body && typeof body === 'object' && Object.keys(body).length > 0
    ? JSON.stringify(body)
    : '';
}

const seenNonces = new Map(); // nonce -> expiresAt
const received = [];
const seenIds = new Set();

/** 复刻 HmacGuard 四道验签；返回 {ok, code}，ok=false 时 code 为 RFC7807 title */
function verifyRequest(rawBody, headers) {
  const bearer = (headers['authorization'] ?? '');
  const token = bearer.replace(/^Bearer\s+/i, '').trim();
  if (token !== TOKEN) return { ok: false, code: 'AUTH_TOKEN_INVALID' };

  const sig = parseSignature(headers['x-signature']);
  if (!sig) return { ok: false, code: 'AUTH_HMAC_SIGNATURE_MISMATCH' };

  if (!isTimestampFresh(sig.ts, Math.floor(Date.now() / 1000), MAX_DRIFT_SECONDS)) {
    return { ok: false, code: 'AUTH_TIMESTAMP_EXPIRED' };
  }

  // §3.1 第 3 步：nonce 唯一（X-Request-Id），重复视为重放
  const nonce = String(headers['x-request-id'] ?? '').trim();
  if (!nonce || nonce.length > 64) return { ok: false, code: 'AUTH_NONCE_MISSING' };

  const now = Date.now();
  for (const [n, exp] of seenNonces) {
    if (exp < now) seenNonces.delete(n);
  }
  if (seenNonces.has(nonce)) return { ok: false, code: 'AUTH_NONCE_DUPLICATE' };
  seenNonces.set(nonce, now + NONCE_TTL_MS);

  // HMAC 重算：rawBody 优先（与 main.ts verify 捕获一致）
  let parsedBody = {};
  try { parsedBody = rawBody ? JSON.parse(rawBody) : {}; } catch { /* 保持空 */ }
  const raw = deriveRawPayload(rawBody, parsedBody);
  if (!verifySignature(raw, sig.ts, sig.v1, HMAC_SECRET)) {
    return { ok: false, code: 'AUTH_HMAC_SIGNATURE_MISMATCH' };
  }
  return { ok: true };
}

/**
 * 复刻 MarketplaceContractController 路由（代表性端点）：
 * - GET  /v1/marketplace/tasks                 listTasks（场景一 #2 商机 Pull）
 * - GET  /v1/marketplace/tasks/:id            getTask（场景一 #3 任务详情）
 * - POST /v1/marketplace/tasks/:id/bids       submitBid（场景二 #4 提交竞标占席位）
 * - PATCH /v1/marketplace/orders/:id          patchOrder（场景三 #6 回填 project_id）
 * - POST /v1/marketplace/orders/:id/spec      submitSpec（场景四 #11 提交 Spec）
 * - POST /v1/marketplace/orders/:id/deliverables submitDeliverables（场景五 #13）
 * - POST /v1/marketplace/orders/:id/settlement/trigger triggerSettlement（场景九 #31）
 * - GET  /v1/marketplace/orders/:id/status    orderStatus（对账 #37）
 * 验签通过后模拟 service 委托响应（200 + 简化数据）。
 */
function routeRequest(method, pathname, body) {
  // 场景一 #2：商机 Pull
  if (method === 'GET' && pathname === '/v1/marketplace/tasks') {
    return { status: 200, body: { tasks: [], next_cursor: null } };
  }
  // 场景一 #3：任务详情（模拟 service：task 不存在抛 404）
  const taskMatch = pathname.match(/^\/v1\/marketplace\/tasks\/([^/]+)$/);
  if (method === 'GET' && taskMatch) {
    return {
      status: 404,
      body: rfc7807('NOT_FOUND', `task ${taskMatch[1]} not found`),
    };
  }
  // 场景二 #4：提交竞标（模拟 service：占席位成功）
  const bidMatch = pathname.match(/^\/v1\/marketplace\/tasks\/([^/]+)\/bids$/);
  if (method === 'POST' && bidMatch) {
    return {
      status: 201,
      body: { bid_id: randomUUID(), task_id: bidMatch[1], seat_status: 'occupied' },
    };
  }
  // 场景三 #6：回填 project_id（幂等）
  const orderPatch = pathname.match(/^\/v1\/marketplace\/orders\/([^/]+)$/);
  if (method === 'PATCH' && orderPatch) {
    return { status: 200, body: { order_id: orderPatch[1], project_id: body.project_id } };
  }
  // 场景四 #11：提交 Spec
  const specMatch = pathname.match(/^\/v1\/marketplace\/orders\/([^/]+)\/spec$/);
  if (method === 'POST' && specMatch) {
    return {
      status: 200,
      body: { order_id: specMatch[1], spec_version: 1, spec_deadline: new Date(Date.now() + 7 * 864e5).toISOString() },
    };
  }
  // 场景五 #13：提交交付物
  const delivMatch = pathname.match(/^\/v1\/marketplace\/orders\/([^/]+)\/deliverables$/);
  if (method === 'POST' && delivMatch) {
    return {
      status: 200,
      body: { order_id: delivMatch[1], delivery_status: 'submitted', review_deadline: new Date(Date.now() + 14 * 864e5).toISOString() },
    };
  }
  // 场景九 #31：触发结算
  const settleMatch = pathname.match(/^\/v1\/marketplace\/orders\/([^/]+)\/settlement\/trigger$/);
  if (method === 'POST' && settleMatch) {
    return {
      status: 200,
      body: { order_id: settleMatch[1], settlement_status: 'triggered', escrow_deadline: new Date(Date.now() + 7 * 864e5).toISOString() },
    };
  }
  // 对账 #37：订单状态查询
  const statusMatch = pathname.match(/^\/v1\/marketplace\/orders\/([^/]+)\/status$/);
  if (method === 'GET' && statusMatch) {
    return { status: 200, body: { order_id: statusMatch[1], contract_status: 'signing' } };
  }
  return { status: 404, body: rfc7807('NOT_FOUND', `no route for ${method} ${pathname}`) };
}

/** RFC 7807 错误信封（与 rfc7807.filter.ts 一致） */
function rfc7807(type, title, status = 400) {
  return { type: `https://csi.example/errors/${type}`, title, status };
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/__received') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: received.length, items: received }, null, 2));
    return;
  }

  // 只接受 /v1/marketplace/* 路径（MarketplaceContractController 前缀）
  if (!url.pathname.startsWith('/v1/marketplace/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rfc7807('NOT_FOUND', `unknown path ${url.pathname}`)));
    return;
  }

  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    // 故障注入（联调重试/死信用）
    const fail = url.searchParams.get('fail');
    if (fail === 'timeout') return; // 不响应 → Console 侧 10s 超时按网络错误重试
    if (fail === '500' || fail === '404') {
      res.writeHead(Number(fail), { 'Content-Type': 'application/problem+json' });
      res.end(JSON.stringify(rfc7807('INJECTED', `injected ${fail}`, Number(fail))));
      return;
    }

    const verdict = verifyRequest(raw, req.headers);
    if (!verdict.ok) {
      res.writeHead(401, { 'Content-Type': 'application/problem+json' });
      res.end(JSON.stringify(rfc7807('AUTH_ERROR', verdict.code, 401)));
      return;
    }

    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* 保持空 */ }
    const eventId = body.event_id ?? body.eventId ?? req.headers['idempotency-key'] ?? '(missing)';
    const dup = seenIds.has(eventId);
    if (!dup) seenIds.add(eventId);

    const { status, body: respBody } = routeRequest(req.method, url.pathname, body);
    if (!dup) {
      received.push({
        at: new Date().toISOString(),
        method: req.method,
        path: url.pathname,
        idempotency_key: eventId,
        body,
      });
      console.log(`[mock-marketplace] ✓ ${req.method} ${url.pathname} → ${status}`);
    } else {
      console.log(`[mock-marketplace] ↺ duplicate idempotency_key=${eventId}（幂等 ACK）`);
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(respBody));
  });
});

/**
 * Console 侧发送方替身：按 hmac-sign.ts 同口径签名，POST 到 Marketplace。
 * 复刻 webhook-dispatcher.cron.ts sendFn 的 header 四件套。
 */
async function sendC2M({ method, path, payload, fail, eventId, nonceOverride, tamperToken, tamperSig, staleTs }) {
  const target = new URL(`http://localhost:${PORT}${path}`);
  if (fail) target.searchParams.set('fail', fail);

  const body = payload ? JSON.stringify(payload) : '';
  const ts = staleTs ?? Math.floor(Date.now() / 1000);
  const v1 = tamperSig ? '0'.repeat(64) : signPayload(body, ts, HMAC_SECRET);
  const token = tamperToken ? 'wrong-token' : TOKEN;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Signature': `t=${ts},v1=${v1}`,
    'X-Request-Id': nonceOverride ?? randomUUID(),
  };
  if (eventId) headers['Idempotency-Key'] = eventId;

  const init = { method, headers };
  if (method !== 'GET' && method !== 'DELETE') init.body = body;

  const res = await fetch(target.toString(), init);
  const text = await res.text();
  return { status: res.status, body: text };
}

async function selftest() {
  console.log(`[selftest] TOKEN=${TOKEN.slice(0, 4)}***  HMAC_SECRET=${HMAC_SECRET.slice(0, 4)}***  PORT=${PORT}`);
  const bidEventId = randomUUID();
  const specEventId = randomUUID();

  // 1. GET 商机 Pull（无 body，签名输入=空串）
  const t1 = await sendC2M({ method: 'GET', path: '/v1/marketplace/tasks' });
  console.log(`[1] GET /tasks → ${t1.status} ${t1.body}（应 200 tasks:[]）`);

  // 2. GET 任务详情（模拟 service：404 task 不存在，验签通过 + Controller 委托）
  const t2 = await sendC2M({ method: 'GET', path: '/v1/marketplace/tasks/task-xyz' });
  console.log(`[2] GET /tasks/task-xyz → ${t2.status} ${t2.body}（应 404 NOT_FOUND，验签通过+委托 service）`);

  // 3. POST 提交竞标（有 body，签名输入=body 原文）
  const t3 = await sendC2M({
    method: 'POST',
    path: '/v1/marketplace/tasks/task-1/bids',
    payload: { workspace_id: 'ws-1', price_cny: 1000, plan_summary: '方案' },
    eventId: bidEventId,
  });
  console.log(`[3] POST /tasks/task-1/bids → ${t3.status} ${t3.body}（应 201 seat occupied）`);

  // 4. 重投同 Idempotency-Key（幂等 ACK）
  const t4 = await sendC2M({
    method: 'POST',
    path: '/v1/marketplace/tasks/task-1/bids',
    payload: { workspace_id: 'ws-1', price_cny: 1000, plan_summary: '方案' },
    eventId: bidEventId,
  });
  console.log(`[4] 重投同 Idempotency-Key → ${t4.status}（应 201，mock-marketplace 标记 duplicate）`);

  // 5. PATCH 回填 project_id
  const t5 = await sendC2M({
    method: 'PATCH',
    path: '/v1/marketplace/orders/order-1',
    payload: { project_id: 'proj-1' },
  });
  console.log(`[5] PATCH /orders/order-1 → ${t5.status} ${t5.body}（应 200 project_id 回填）`);

  // 6. POST 提交 Spec
  const t6 = await sendC2M({
    method: 'POST',
    path: '/v1/marketplace/orders/order-1/spec',
    payload: { spec_content: '需求契约', spec_hash: 'sha256:abc' },
    eventId: specEventId,
  });
  console.log(`[6] POST /orders/order-1/spec → ${t6.status} ${t6.body}（应 200 spec_version=1）`);

  // 7. POST 提交交付物
  const t7 = await sendC2M({
    method: 'POST',
    path: '/v1/marketplace/orders/order-1/deliverables',
    payload: { artifact_urls: ['https://example.com/artifact.zip'] },
  });
  console.log(`[7] POST /orders/order-1/deliverables → ${t7.status} ${t7.body}（应 200 delivery_status=submitted）`);

  // 8. POST 触发结算
  const t8 = await sendC2M({
    method: 'POST',
    path: '/v1/marketplace/orders/order-1/settlement/trigger',
    payload: {},
  });
  console.log(`[8] POST /orders/order-1/settlement/trigger → ${t8.status} ${t8.body}（应 200 settlement_status=triggered）`);

  // 9. 篡改 Bearer → 401 AUTH_TOKEN_INVALID
  const t9 = await sendC2M({
    method: 'GET',
    path: '/v1/marketplace/tasks',
    tamperToken: true,
  });
  console.log(`[9] 篡改 Bearer → ${t9.status} ${t9.body}（应 401 AUTH_TOKEN_INVALID）`);

  // 10. 篡改签名 → 401 AUTH_HMAC_SIGNATURE_MISMATCH
  const t10 = await sendC2M({
    method: 'POST',
    path: '/v1/marketplace/tasks/task-1/bids',
    payload: { workspace_id: 'ws-1', price_cny: 500 },
    tamperSig: true,
  });
  console.log(`[10] 篡改签名 → ${t10.status} ${t10.body}（应 401 AUTH_HMAC_SIGNATURE_MISMATCH）`);

  // 11. nonce 重复 → 401 AUTH_NONCE_DUPLICATE
  const reusedNonce = randomUUID();
  await sendC2M({ method: 'GET', path: '/v1/marketplace/tasks', nonceOverride: reusedNonce });
  const t11 = await sendC2M({ method: 'GET', path: '/v1/marketplace/tasks', nonceOverride: reusedNonce });
  console.log(`[11] nonce 重复 → ${t11.status} ${t11.body}（应 401 AUTH_NONCE_DUPLICATE）`);

  // 12. timestamp 过期 → 401 AUTH_TIMESTAMP_EXPIRED
  const t12 = await sendC2M({
    method: 'GET',
    path: '/v1/marketplace/tasks',
    staleTs: Math.floor(Date.now() / 1000) - 600, // 10min 前，超 5min 窗口
  });
  console.log(`[12] timestamp 过期 → ${t12.status} ${t12.body}（应 401 AUTH_TIMESTAMP_EXPIRED）`);

  // 13. 故障注入 500（Console 侧按 5xx 重试）
  const t13 = await sendC2M({
    method: 'POST',
    path: '/v1/marketplace/tasks/task-1/bids',
    payload: { workspace_id: 'ws-1', price_cny: 500 },
    fail: '500',
  });
  console.log(`[13] ?fail=500 → ${t13.status}（应 500）`);

  // 14. 故障注入 404（Console 侧按 4xx 死信）
  const t14 = await sendC2M({
    method: 'POST',
    path: '/v1/marketplace/tasks/task-1/bids',
    payload: { workspace_id: 'ws-1', price_cny: 500 },
    fail: '404',
  });
  console.log(`[14] ?fail=404 → ${t14.status}（应 404）`);

  // 15. 查看快照
  const snap = await fetch(`http://localhost:${PORT}/__received`).then((r) => r.json());
  console.log(`[15] /__received → count=${snap.count}`);
  console.log(JSON.stringify(snap.items, null, 2));
}

server.listen(PORT, async () => {
  console.log(`[mock-marketplace] Marketplace 接收替身已启动: http://localhost:${PORT}`);
  console.log(`[mock-marketplace] Token: ${TOKEN.slice(0, 4)}***  HMAC_SECRET: ${HMAC_SECRET.slice(0, 4)}***`);
  console.log(`[mock-marketplace] 故障注入: ?fail=500|404|timeout；查看快照: GET /__received`);
  if (SELFTEST) {
    try {
      await selftest();
    } catch (err) {
      console.error('[selftest] FAILED:', err);
      process.exitCode = 1;
    } finally {
      server.close();
      process.exit(0);
    }
  }
});
