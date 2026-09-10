/**
 * Console 契约测试替身（M 侧镜像 mock）。
 * 职责：模拟 Console 侧 17 个 Webhook 入站端点（M→C 方向），记录事件供断言；
 * 与 Console 侧自带的 Marketplace 替身互为镜像，联调前双方各自与替身跑通。
 *
 * 用法：
 *   node test/console-mock/mock-console.mjs            # 独立启动（默认 8788）
 *   import { createMockConsole } from './mock-console.mjs'  # runner 内嵌启动
 */
import http from 'node:http';

export const CONSOLE_WEBHOOK_PATHS = [
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
  '/v1/webhooks/delivery/employer-review',
];

export function createMockConsole({ port = 8788 } = {}) {
  const events = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/__events') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ count: events.length, events }));
      return;
    }
    if (url.pathname === '/__health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      // 契约端点校验：路径合法 + 必备头（验签由 M 侧出站负责，替身只做接收语义）
      const known = CONSOLE_WEBHOOK_PATHS.includes(url.pathname);
      const auth = req.headers['authorization'] ?? '';
      const sig = req.headers['x-signature'] ?? '';
      const idem = req.headers['idempotency-key'] ?? '';
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = raw;
      }
      const record = {
        path: url.pathname,
        known,
        at: new Date().toISOString(),
        hasBearer: String(auth).startsWith('Bearer '),
        hasSignature: String(sig).startsWith('t='),
        idempotencyKey: String(idem),
        event_id: payload?.event_id ?? null,
        event_type: payload?.event_type ?? payload?.data?.event_type ?? null,
        payload,
      };
      events.push(record);
      if (!known) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unknown webhook path' }));
        return;
      }
      // Console 语义：先 200 ACK，再异步处理（bid.won 尤其如此）
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ack: true }));
    });
  });

  return {
    events,
    listen: () =>
      new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve())),
    close: () => new Promise((resolve) => server.close(() => resolve())),
    baseUrl: `http://127.0.0.1:${port}`,
    find: (eventType) => events.filter((e) => e.event_type === eventType),
  };
}

// 独立启动模式
if (import.meta.url === `file://${process.argv[1]}`) {
  const mock = createMockConsole();
  await mock.listen();
  console.log(`Console mock listening on ${mock.baseUrl}`);
  console.log(`  events: ${mock.baseUrl}/__events`);
}
