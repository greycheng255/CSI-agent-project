/**
 * M↔C 契约联调 runner（与 Console 侧 Marketplace 替身互为镜像）：
 *  - 启动 Console mock（模拟 M→C 的 17 个入站端点）
 *  - 以「Console 身份」带 HMAC 签名调用 M 的 C→M 契约端点（场景一/二）
 *  - 驱动雇主选标（场景三）并断言 outbox 已入队 bid.won / bid.lost
 *  - 模拟 Console 回填 project_id（场景三 #6）并回读校验
 *
 * 运行：npm run test:console-contract   （需 4001 后端已启动）
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createMockConsole } from './mock-console.mjs';

const M_ROOT = process.env.M_ROOT ?? 'http://127.0.0.1:4001';
const M_API = `${M_ROOT}/api/v1`;

let passed = 0;
let failed = 0;
const ok = (s) => s >= 200 && s < 300;
function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}
async function req(base, path, opts = {}) {
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

// ---- 契约签名（§3.1）：X-Signature: t=<ts>,v1=<hex(hmac_sha256(body+ts))>，GET 空 body ----
const env = Object.fromEntries(
  readFileSync('/home/ubuntu/csi-agent-project-new/CSI-agent-project/.env', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const SERVICE_TOKEN =
  env.LONGTASK_INBOUND_TOKEN ?? env.LONGTASK_SERVICE_TOKEN ?? '';
const HMAC_SECRET = env.LONGTASK_INBOUND_HMAC_SECRET || SERVICE_TOKEN;

function signHeaders(bodyText) {
  const ts = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', HMAC_SECRET).update(bodyText + ts).digest('hex');
  return {
    Authorization: `Bearer ${SERVICE_TOKEN}`,
    'X-Signature': `t=${ts},v1=${v1}`,
    'X-Request-Id': randomUUID(),
    'Idempotency-Key': randomUUID(),
  };
}
async function contractReq(method, path, bodyObj) {
  const bodyText = bodyObj ? JSON.stringify(bodyObj) : '';
  return req(M_ROOT, path, {
    method,
    headers: signHeaders(bodyText),
    ...(bodyText ? { body: bodyText } : {}),
  });
}

async function devLogin(phone) {
  await req(M_API, '/users/sms-code', {
    method: 'POST',
    body: JSON.stringify({ phone, scene: 'login' }),
  });
  const login = await req(M_API, '/users/login/sms', {
    method: 'POST',
    body: JSON.stringify({ phone, verificationCode: '121212' }),
  });
  if (!login.data?.token) throw new Error(`login failed for ${phone}`);
  return login.data;
}

const mock = createMockConsole();
await mock.listen();
console.log(`Console mock: ${mock.baseUrl}`);
// 事件断言时间锚点：早于全部场景（含场景一二三的出站）
const runStart = new Date();

try {
  // 0) 替身自检：能收事件、能识别未知路径
  const selfTest = await req(mock.baseUrl, '/v1/webhooks/bid/result', {
    method: 'POST',
    body: JSON.stringify({ event_id: 'mock-selftest', event_type: 'bid.won' }),
  });
  check('替身：接收已知 webhook 路径并 200 ACK', selfTest.status === 200 && selfTest.data?.ack === true);
  const unknown = await req(mock.baseUrl, '/v1/webhooks/unknown', { method: 'POST', body: '{}' });
  check('替身：未知路径 404', unknown.status === 404);
  mock.events.length = 0;

  // 1) 账号与任务（内部 REST）
  const employer = await devLogin('13300000001');
  const bidderA = await devLogin('13800138000');
  const bidderB = await devLogin('13300000002');
  const wsA = (await req(M_API, `/longtask/workspaces/owner/${bidderA.user.id}`)).data;
  const wsB = (await req(M_API, `/longtask/workspaces/owner/${bidderB.user.id}`)).data;
  check('两位 owner 均有默认工作室', !!wsA?.id && !!wsB?.id);

  const created = await req(M_API, '/longtask/marketplace-tasks/create-and-publish', {
    method: 'POST',
    headers: { Authorization: `Bearer ${employer.token}` },
    body: JSON.stringify({
      employerUserId: employer.user.id,
      title: `契约替身-${Date.now()}`,
      categoryId: 'web',
      budgetMaxCny: 3000,
      seatLimit: 3,
      ttlDays: 1,
    }),
  });
  const taskId = created.data?.id;
  check('雇主发布任务 open', ok(created.status) && created.data?.status === 'open');

  // 2) 场景一 #2：Console Pull（签名 GET，空 body）
  const pull = await contractReq('GET', '/v1/marketplace/tasks?limit=50');
  const pulled = Array.isArray(pull.data?.tasks) ? pull.data.tasks : [];
  check('场景一：签名 GET /v1/marketplace/tasks 200', ok(pull.status), `status=${pull.status}`);
  check('场景一：Pull 结果含新建任务', pulled.some((t) => t.task_id === taskId || t.id === taskId));

  // 3) 场景二 #4：Console 提交竞标（占席位）
  const cBid = await contractReq('POST', `/v1/marketplace/tasks/${taskId}/bids`, {
    workspace_id: wsA.id,
    price_cny: 900,
    plan_summary: 'Console 契约替身提交',
    source: 'pull',
    workspace_name: wsA.name,
  });
  check('场景二：签名 POST bids 占席位成功', ok(cBid.status) && cBid.data?.seatTaken === 1, JSON.stringify(cBid.data).slice(0, 160));
  const bidIdA = cBid.data?.bid?.id;

  // 4) 第二家（owner 手动）→ 用于 bid.lost 断言
  const bidB = await req(M_API, '/longtask/owner/bids', {
    method: 'POST',
    headers: { Authorization: `Bearer ${bidderB.token}` },
    body: JSON.stringify({ taskId, workspaceId: wsB.id, priceCny: 800 }),
  });
  check('owner 手动竞标占位（第二家）', ok(bidB.status) && bidB.data?.seatTaken === 2);

  // 5) 场景三：雇主选标 → Order + bid.won / bid.lost
  const sel = await req(M_API, `/longtask/marketplace-tasks/${taskId}/select`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${employer.token}` },
    body: JSON.stringify({ bidId: bidIdA }),
  });
  check('场景三：雇主选标成功（Order signing）', ok(sel.status) && sel.data?.contractStatus === 'signing');
  const orderId = sel.data?.id;

  // 6) 场景三 #6：Console 回填 project_id（签名 PATCH，项目 ID 为 uuid）
  const mockProjectId = randomUUID();
  const backfill = await contractReq('PATCH', `/v1/marketplace/orders/${orderId}`, {
    project_id: mockProjectId,
  });
  check('场景三：签名 PATCH orders/:id 回填 project_id', ok(backfill.status), `status=${backfill.status}`);
  const statusView = await contractReq('GET', `/v1/marketplace/orders/${orderId}/status`);
  check('场景三：回读 order status 带 project_id', ok(statusView.status) && statusView.data?.project_id === mockProjectId, JSON.stringify(statusView.data).slice(0, 160));

  // ===== 第 2/3 批：场景四~十（每场景一条独立订单链）=====
  const aEmp = { Authorization: `Bearer ${employer.token}` };

  async function createOrderChain(tag) {
    const createdTask = await req(M_API, '/longtask/marketplace-tasks/create-and-publish', {
      method: 'POST',
      headers: aEmp,
      body: JSON.stringify({
        employerUserId: employer.user.id,
        title: `契约替身-${tag}-${Date.now()}`,
        categoryId: 'web',
        budgetMaxCny: 5000,
        seatLimit: 3,
        ttlDays: 1,
      }),
    });
    const tId = createdTask.data.id;
    const cbid = await contractReq('POST', `/v1/marketplace/tasks/${tId}/bids`, {
      workspace_id: wsA.id,
      price_cny: 1000,
      plan_summary: `${tag} 方案`,
      source: 'pull',
      workspace_name: wsA.name,
    });
    const selRes = await req(M_API, `/longtask/marketplace-tasks/${tId}/select`, {
      method: 'POST',
      headers: aEmp,
      body: JSON.stringify({ bidId: cbid.data?.bid?.id }),
    });
    return { taskId: tId, orderId: selRes.data?.id };
  }

  async function specAndConfirm(orderId) {
    const spec = await contractReq('POST', `/v1/marketplace/orders/${orderId}/spec`, {
      spec_content: { goal: '交付一套企业官网' },
      spec_hash: 'mock-hash-1',
      milestones: [{ name: 'M1', weight: 1 }],
    });
    const confirm = await req(M_API, `/longtask/employer/orders/${orderId}/spec-action`, {
      method: 'POST',
      headers: aEmp,
      body: JSON.stringify({ action: 'confirmed' }),
    });
    return { spec, confirm };
  }

  // 场景四/五：Spec 签订 → 交付 → 验收
  const o5 = await createOrderChain('S5');
  const s5 = await specAndConfirm(o5.orderId);
  check('场景四 #11 提交 Spec → awaiting_confirmation', ok(s5.spec.status) && s5.spec.data?.contractStatus === 'awaiting_confirmation', JSON.stringify(s5.spec.data).slice(0, 140));
  check('场景四 #12 雇主确认 Spec → signed', ok(s5.confirm.status) && s5.confirm.data?.contractStatus === 'signed');
  const deliv5 = await contractReq('POST', `/v1/marketplace/orders/${o5.orderId}/deliverables`, {
    metadata: { note: '交付说明' },
    artifact_urls: ['https://oss.mock/x.zip'],
    submission_seq: 1,
  });
  check('场景五 #13 交付物提交（启动 14 天计时）', ok(deliv5.status) && deliv5.data?.status === 'submitted', JSON.stringify(deliv5.data).slice(0, 140));
  const review5 = await req(M_API, `/longtask/employer/orders/${o5.orderId}/review`, {
    method: 'POST',
    headers: aEmp,
    body: JSON.stringify({ action: 'accepted' }),
  });
  check('场景五 #14 雇主验收 accepted', ok(review5.status) && review5.data?.status === 'accepted');

  // 雇主订单页（内部读取端点）：我的订单列表 + 详情（Spec 快照/里程碑/交付物）
  const myOrders = await req(M_API, '/longtask/employer/orders', { headers: aEmp });
  check(
    '雇主订单页：GET 我的订单列表含本单（带任务标题/中标工作室）',
    Array.isArray(myOrders.data) &&
      myOrders.data.some(
        (o) => o.id === o5.orderId && !!o.taskTitle && !!o.workspaceName,
      ),
    `status=${myOrders.status}`,
  );
  const detail5 = await req(M_API, `/longtask/employer/orders/${o5.orderId}`, {
    headers: aEmp,
  });
  check(
    '雇主订单页：详情返回 Spec 快照 / 版本 / 里程碑',
    ok(detail5.status) &&
      detail5.data?.order?.specSnapshot?.content?.goal === '交付一套企业官网' &&
      detail5.data?.order?.specVersion === 1 &&
      Array.isArray(detail5.data?.order?.milestones) &&
      detail5.data?.order?.milestones.length === 1,
    JSON.stringify(detail5.data?.order).slice(0, 160),
  );
  check(
    '雇主订单页：详情含交付物与验收后的售后计时',
    ok(detail5.status) &&
      detail5.data?.deliveries?.length === 1 &&
      detail5.data?.deliveries?.[0]?.status === 'accepted' &&
      detail5.data?.order?.deliveryStatus === 'accepted' &&
      !!detail5.data?.order?.afterSaleDeadline,
    JSON.stringify(detail5.data?.order).slice(0, 160),
  );
  const otherRead = await req(M_API, `/longtask/employer/orders/${o5.orderId}`, {
    headers: { Authorization: `Bearer ${bidderB.token}` },
  });
  check('雇主订单页：非雇主读取他人订单 → 403', otherRead.status === 403, `status=${otherRead.status}`);

  // 场景六：修订协商（#14 revision_requested → #15 start → #16 decide C）
  const o6 = await createOrderChain('S6');
  await specAndConfirm(o6.orderId);
  await contractReq('POST', `/v1/marketplace/orders/${o6.orderId}/deliverables`, {
    metadata: { note: 'v1' },
    submission_seq: 1,
  });
  const rev6 = await req(M_API, `/longtask/employer/orders/${o6.orderId}/review`, {
    method: 'POST',
    headers: aEmp,
    body: JSON.stringify({ action: 'revision_requested', reason: '样式不符' }),
  });
  check('场景五 #14 修订请求 → revising', ok(rev6.status) && rev6.data?.status === 'revision_requested');
  const neg6 = await contractReq('POST', `/v1/marketplace/orders/${o6.orderId}/revision-negotiation/start`, { reason: 'revision_exhausted' });
  check('场景六 #15 启动 2 天协商窗口', ok(neg6.status) && !!neg6.data?.deadline, JSON.stringify(neg6.data).slice(0, 120));
  const dec6 = await contractReq('POST', `/v1/marketplace/orders/${o6.orderId}/revision-negotiation/${neg6.data?.id}/decide`, { decision: 'C' });
  check('场景六 #16 决策 C（接受当前）', ok(dec6.status) && dec6.data?.decision === 'C');

  // 场景七：Spec 变更（#18 请求 → #19 classify → #20 雇主确认 → #21/#22 提案确认）
  const o7 = await createOrderChain('S7');
  await specAndConfirm(o7.orderId);
  const chg7 = await req(M_API, `/longtask/employer/orders/${o7.orderId}/spec-change-requests`, {
    method: 'POST',
    headers: aEmp,
    body: JSON.stringify({ change_seq: 1, payload: { note: '新增登录模块' } }),
  });
  check('场景七 #18 雇主发起变更请求', ok(chg7.status) && !!chg7.data?.id);
  const cls7 = await contractReq('POST', `/v1/marketplace/orders/${o7.orderId}/revision-requests/${chg7.data?.id}/classify`, { classification: 'new_requirement' });
  check('场景七 #19 Console 判定 new_requirement', ok(cls7.status) && cls7.data?.classification === 'new_requirement');
  const ec7 = await req(M_API, `/longtask/employer/orders/${o7.orderId}/spec-changes/${chg7.data?.id}/confirm`, {
    method: 'POST',
    headers: aEmp,
    body: JSON.stringify({ decision: 'confirmed' }),
  });
  check('场景七 #20 雇主二次确认 confirmed', ok(ec7.status) && ec7.data?.status === 'confirmed');
  const prop7 = await contractReq('POST', `/v1/marketplace/orders/${o7.orderId}/spec-changes`, { change_seq: 2, payload: { note: 'v2' } });
  const cfm7 = await contractReq('POST', `/v1/marketplace/orders/${o7.orderId}/spec-changes/${prop7.data?.id}/confirm`, {});
  check('场景七 #22 变更确认（Spec version+1 落 order）', ok(cfm7.status) && cfm7.data?.status === 'confirmed', JSON.stringify(cfm7.data).slice(0, 140));

  // 场景八：协商取消（#24 发起 → #25 accept → #28 finalize）
  const o8 = await createOrderChain('S8');
  await specAndConfirm(o8.orderId);
  const cr8 = await req(M_API, `/longtask/employer/orders/${o8.orderId}/cancel-requests`, {
    method: 'POST',
    headers: aEmp,
    body: '{}',
  });
  check('场景八 #24 雇主发起协商取消', ok(cr8.status) && !!cr8.data?.id);
  const resp8 = await contractReq('POST', `/v1/marketplace/orders/${o8.orderId}/cancel-requests/${cr8.data?.id}/respond`, { response: 'accept' });
  check('场景八 #25 Owner 响应 accept', ok(resp8.status), `status=${resp8.status}`);
  const fin8 = await contractReq('POST', `/v1/marketplace/orders/${o8.orderId}/cancel-requests/${cr8.data?.id}/finalize`, {});
  check('场景八 #28 最终确认取消结算', ok(fin8.status), `status=${fin8.status}`);
  const detail8 = await req(M_API, `/longtask/employer/orders/${o8.orderId}`, {
    headers: aEmp,
  });
  check(
    '雇主订单页：详情含最新取消协商状态',
    ok(detail8.status) && detail8.data?.latestCancelRequest?.status === 'finalized',
    JSON.stringify(detail8.data?.latestCancelRequest).slice(0, 140),
  );

  // 场景九：结算触发 → 结算回执 → #32 通知 Console
  const o9 = await createOrderChain('S9');
  await specAndConfirm(o9.orderId);
  await contractReq('POST', `/v1/marketplace/orders/${o9.orderId}/deliverables`, { metadata: { note: 'done' }, submission_seq: 1 });
  await req(M_API, `/longtask/employer/orders/${o9.orderId}/review`, {
    method: 'POST',
    headers: aEmp,
    body: JSON.stringify({ action: 'accepted' }),
  });
  const st9 = await contractReq('POST', `/v1/marketplace/orders/${o9.orderId}/settlement/trigger`, {});
  check('场景九 #31 结算触发（里程碑权重 100%）', ok(st9.status) && st9.data?.status === 'pending', JSON.stringify(st9.data).slice(0, 140));
  const sc9 = await contractReq('POST', `/v1/marketplace/ops/orders/${o9.orderId}/settlement-completed`, {});
  check('场景九 #32 结算完成回执 → settled', ok(sc9.status) && sc9.data?.status === 'settled');

  // 场景十：纠纷仲裁（#39 发起 → #41 启动 → #42 裁定 → #43 确认）
  const o10 = await createOrderChain('S10');
  await specAndConfirm(o10.orderId);
  await contractReq('POST', `/v1/marketplace/orders/${o10.orderId}/deliverables`, { metadata: { note: 'done' }, submission_seq: 1 });
  await req(M_API, `/longtask/employer/orders/${o10.orderId}/review`, {
    method: 'POST',
    headers: aEmp,
    body: JSON.stringify({ action: 'accepted' }),
  });
  const dsp10 = await req(M_API, `/longtask/employer/orders/${o10.orderId}/disputes`, {
    method: 'POST',
    headers: aEmp,
    body: JSON.stringify({ reason: '交付质量争议' }),
  });
  check('场景十 #39 雇主发起纠纷（举证窗口开启）', ok(dsp10.status) && dsp10.data?.status === 'evidence_open');
  const aStart = await contractReq('POST', `/v1/marketplace/ops/disputes/${dsp10.data?.id}/arbitration-start`, {});
  check('场景十 #41 平台受理并启动仲裁', ok(aStart.status) && aStart.data?.status === 'arbitrating');
  const aRes = await contractReq('POST', `/v1/marketplace/ops/disputes/${dsp10.data?.id}/arbitration-result`, { resolution: 'cancel' });
  check('场景十 #42 仲裁裁定 cancel', ok(aRes.status) && aRes.data?.resolution === 'cancel');
  const ack10 = await contractReq('POST', `/v1/marketplace/orders/${o10.orderId}/disputes/${dsp10.data?.id}/acknowledge`, {});
  check('场景十 #43 Owner 确认仲裁结果 → 终态', ok(ack10.status) && ack10.data?.status === 'acknowledged');
  const detail10 = await req(M_API, `/longtask/employer/orders/${o10.orderId}`, {
    headers: aEmp,
  });
  check(
    '雇主订单页：详情含最新纠纷状态',
    ok(detail10.status) && detail10.data?.latestDispute?.status === 'acknowledged',
    JSON.stringify(detail10.data?.latestDispute).slice(0, 140),
  );

  // ===== outbox 断言：全场景出站事件（DB 权威口径）=====
  const client = new pg.Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
  });
  await client.connect();
  const expectedEvents = [
    'bid.won',
    'bid.lost',
    'spec.confirmed',
    'delivery.accepted',
    'delivery.revision_requested',
    'revision.negotiation_started',
    'revision.negotiation_decided',
    'spec_change.requested',
    'spec_change.employer_confirmed',
    'project.cancel_request',
    'settlement.completed',
    'project.dispute_raised',
    'dispute.arbitration_started',
    'dispute.arbitration_result',
  ];
  const evRows = (
    await client.query(
      'SELECT DISTINCT event_type FROM webhook_outbox WHERE created_at >= $1 AND event_type = ANY($2)',
      [runStart, expectedEvents],
    )
  ).rows;
  const seen = new Set(evRows.map((r) => r.event_type));
  const missing = expectedEvents.filter((e) => !seen.has(e));
  check(`出站：${expectedEvents.length} 类事件全部入队`, missing.length === 0, `missing=${missing.join(',')}`);
  await client.end();

} finally {
  await mock.close();
}

console.log(`\nConsole-contract runner: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
