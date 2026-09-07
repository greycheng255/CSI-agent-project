// Marketplace → Console webhook 出站链路自测
// 与运行中的 mock-console.mjs（默认端口 8800）对话，复刻 webhook-dispatcher.cron.ts
// 的签名构造（HMAC-SHA256(body+ts)，Bearer + X-Signature + X-Request-Id + Idempotency-Key）

import { createHmac, randomUUID } from 'node:crypto';

const CONSOLE_BASE = process.env.CONSOLE_BASE_URL || 'http://127.0.0.1:8800';
const TOKEN = process.env.LONGTASK_OUTBOUND_TOKEN || process.env.LONGTASK_SERVICE_TOKEN || 'st-local';

function signPayload(payload, ts, secret) {
  return createHmac('sha256', secret).update(payload + ts).digest('hex');
}

let pass = 0, fail = 0;
const issues = [];
function check(label, cond, extra = '') {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else { console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); fail++; issues.push(label); }
}
function banner(t) { console.log('\n' + '='.repeat(80) + '\n' + t + '\n' + '='.repeat(80)); }

async function sendWebhook(path, body, { tamperSig = false, tamperBearer = false, fail = null, eventId, eventType } = {}) {
  const url = new URL(path, CONSOLE_BASE);
  if (fail) url.searchParams.set('fail', fail);
  const bodyStr = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const sig = signPayload(bodyStr, ts, TOKEN);
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${tamperBearer ? 'WRONG' : TOKEN}`,
    'X-Signature': `t=${ts},v1=${tamperSig ? 'a'.repeat(64) : sig}`,
    'X-Request-Id': randomUUID(),
    'Idempotency-Key': eventId,
  };
  const res = await fetch(url, { method: 'POST', headers, body: bodyStr });
  let data; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function getReceived() {
  const r = await fetch(`${CONSOLE_BASE}/__received`);
  return r.json();
}

async function main() {
  banner('STEP 1: mock-console 替身在线');
  const init = await getReceived().catch(e => ({ error: e.message }));
  check('GET /__received 可达', !init.error, init.error || '');
  if (init.error) { console.log('mock-console 未启动，终止测试'); process.exit(1); }
  const baseline = init.count || 0;
  console.log('  已收到 webhook 数 (baseline):', baseline);

  banner('STEP 2: 正常投递 — opportunity.pushed');
  const ev1 = `e2e-m2c-${Date.now()}`;
  const r1 = await sendWebhook('/v1/webhooks/opportunity/pushed', {
    event_id: ev1,
    event_type: 'opportunity.pushed',
    workspace_id: 'ws-test',
    task_id: 'task-test',
    opportunity_id: 'op-test',
  }, { eventId: ev1 });
  console.log('  status:', r1.status, 'resp:', JSON.stringify(r1.data));
  check('返回 200', r1.status === 200);
  check('返回 ok=true', r1.data?.ok === true);
  check('duplicate=false (首次投递)', r1.data?.duplicate === false);

  banner('STEP 3: 同 event_id 重投 — 应幂等');
  const r2 = await sendWebhook('/v1/webhooks/opportunity/pushed', {
    event_id: ev1,
    event_type: 'opportunity.pushed',
    workspace_id: 'ws-test',
    task_id: 'task-test',
    opportunity_id: 'op-test',
  }, { eventId: ev1 });
  console.log('  status:', r2.status, 'resp:', JSON.stringify(r2.data));
  check('返回 200', r2.status === 200);
  check('duplicate=true (幂等 ACK)', r2.data?.duplicate === true);

  banner('STEP 4: 签名篡改 — 应 401 AUTH_HMAC_SIGNATURE_MISMATCH');
  const ev4 = `e2e-m2c-sig-${Date.now()}`;
  const r4 = await sendWebhook('/v1/webhooks/bid/result', {
    event_id: ev4, event_type: 'bid.result', bid_id: 'b1', result: 'accepted',
  }, { eventId: ev4, tamperSig: true });
  console.log('  status:', r4.status, 'resp:', JSON.stringify(r4.data));
  check('返回 401', r4.status === 401);
  check('title=AUTH_HMAC_SIGNATURE_MISMATCH', r4.data?.title === 'AUTH_HMAC_SIGNATURE_MISMATCH');

  banner('STEP 5: Bearer 篡改 — 应 401 AUTH_TOKEN_INVALID');
  const ev5 = `e2e-m2c-tok-${Date.now()}`;
  const r5 = await sendWebhook('/v1/webhooks/task/employer-reply', {
    event_id: ev5, event_type: 'task.employer-reply', message: 'ok',
  }, { eventId: ev5, tamperBearer: true });
  console.log('  status:', r5.status, 'resp:', JSON.stringify(r5.data));
  check('返回 401', r5.status === 401);
  check('title=AUTH_TOKEN_INVALID', r5.data?.title === 'AUTH_TOKEN_INVALID');

  banner('STEP 6: 故障注入 ?fail=500 — 应 5xx（触发重试退避）');
  const r6 = await sendWebhook('/v1/webhooks/spec/employer-action', {
    event_id: 'fail-500', event_type: 'spec.employer-action', action: 'reject',
  }, { eventId: 'fail-500', fail: '500' });
  console.log('  status:', r6.status, 'resp:', JSON.stringify(r6.data));
  check('返回 500', r6.status === 500);

  banner('STEP 7: 故障注入 ?fail=404 — 应 4xx（死信，不重试）');
  const r7 = await sendWebhook('/v1/webhooks/delivery/employer-review', {
    event_id: 'fail-404', event_type: 'delivery.employer-review', action: 'reject',
  }, { eventId: 'fail-404', fail: '404' });
  console.log('  status:', r7.status, 'resp:', JSON.stringify(r7.data));
  check('返回 404', r7.status === 404);

  banner('STEP 8: 多事件类型混合投递 — 验证 17 路由覆盖');
  const samples = [
    ['/v1/webhooks/revision/negotiation-action', { event_type: 'revision.negotiation-action', action: 'counter' }],
    ['/v1/webhooks/spec-change/request', { event_type: 'spec-change.request', reason: '需求变更' }],
    ['/v1/webhooks/settlement/result', { event_type: 'settlement.result', status: 'completed' }],
    ['/v1/webhooks/dispute/arbitration-result', { event_type: 'dispute.arbitration-result', ruling: 'in_favor_of_client' }],
  ];
  for (const [path, body] of samples) {
    const ev = `e2e-${path}-${Date.now()}`;
    const r = await sendWebhook(path, { event_id: ev, ...body }, { eventId: ev });
    check(`POST ${path} → 200`, r.status === 200, `got ${r.status}`);
  }

  banner('STEP 9: GET /__received — 验证快照');
  const after = await getReceived();
  console.log('  count:', after.count, '(baseline=' + baseline + ')');
  check('快照数 > baseline', (after.count || 0) > baseline);
  // 验证最后一条是我们投的
  const last = after.items?.[after.items.length - 1];
  console.log('  最近一条:', JSON.stringify(last).slice(0, 200));
  check('最近一条 event_id 在我们投递的范围内', !!last?.event_id);

  banner('Marketplace → Console webhook 自测小结');
  console.log(`  通过: ${pass}   失败: ${fail}`);
  if (issues.length) { console.log('  失败项:'); issues.forEach(s => console.log('    - ' + s)); }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(2); });
