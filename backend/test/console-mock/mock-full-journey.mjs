/**
 * 签约→交付→验收→结算划款 全链 mock 演练（雇主视角）：
 * 对指定订单依次模拟：
 *   Console 推 Spec(#11) → 雇主确认(#12) → Console 交付(#13) →
 *   雇主验收(#14) → Console 触发结算(#31) → 关联回写完成(#32, ops) → 工作室 Owner 入账
 *
 * 运行：node test/console-mock/mock-full-journey.mjs  （需本地 dev 后端已启动）
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const M_ROOT = process.env.M_ROOT ?? 'http://127.0.0.1:4003';
const M_API = `${M_ROOT}/api/v1`;
const EMPLOYER_PHONE = process.env.EMPLOYER_PHONE ?? '18521524565';
const ORDERS = (process.env.ORDERS ?? [
  '91af4036-07af-49d3-9ed4-966e9a6cf2b1', // 测试数据07 ¥49
  '3ce3e495-d9bb-4b47-b743-52c8fbbcea7d', // 测试数据06 ¥41
  '26e3d70b-3de6-4516-9403-1dc026281e35', // 测试数据05 ¥31
].join(',')).split(',').filter(Boolean);

let passed = 0;
let failed = 0;
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

// ---- env / HMAC（与契约 runner 一致：X-Signature: t=,v1=hex(body+ts)）----
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

const employer = await devLogin(EMPLOYER_PHONE);
const aEmp = { Authorization: `Bearer ${employer.token}` };

const client = new pg.Client({
  host: env.DB_HOST,
  port: Number(env.DB_PORT),
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
});
await client.connect();

for (const orderId of ORDERS) {
  console.log(`\n===== 订单 ${orderId} =====`);
  const before = (
    await client.query(
      `SELECT t.title, o.final_price_cny, o.contract_status, o.payment_status,
              o.delivery_status, o.settlement_status, w.owner_user_id, w.name AS ws_name
       FROM marketplace_orders o
       JOIN marketplace_tasks t ON t.id = o.marketplace_task_id
       JOIN workspaces w ON w.id = o.workspace_id
       WHERE o.id = $1`,
      [orderId],
    )
  ).rows[0];
  console.log(
    `任务「${before.title}」 | ¥${before.final_price_cny} | ${before.ws_name} | contract=${before.contract_status} payment=${before.payment_status}`,
  );
  const ownerBalanceBefore = (
    await client.query('SELECT available_cny FROM user_balances WHERE user_id = $1', [
      before.owner_user_id,
    ])
  ).rows[0]?.available_cny ?? 0;

  // 1) Console 推 Spec（#11）
  const spec = await contractReq(
    'POST',
    `/v1/marketplace/orders/${orderId}/spec`,
    {
      spec_content: {
        goal: `交付「${before.title}」约定的成果`,
        deliverables: ['源码包', '部署文档'],
        acceptance_criteria: '雇主按里程碑验收通过',
      },
      spec_hash: null,
      milestones: [{ name: 'M1 交付验收', weight: 1, status: 'verified_passed' }],
    },
  );
  check('#11 推 Spec → awaiting_confirmation', ok(spec.status) && spec.data?.contractStatus === 'awaiting_confirmation', JSON.stringify(spec.data).slice(0, 120));

  // 2) 雇主确认 Spec（#12）
  const confirm = await req(M_API, `/longtask/employer/orders/${orderId}/spec-action`, {
    method: 'POST',
    headers: aEmp,
    body: JSON.stringify({ action: 'confirmed' }),
  });
  check('#12 雇主确认 → signed', ok(confirm.status) && confirm.data?.contractStatus === 'signed', JSON.stringify(confirm.data).slice(0, 120));

  // 3) Console 提交交付物（#13）
  const deliv = await contractReq(
    'POST',
    `/v1/marketplace/orders/${orderId}/deliverables`,
    {
      metadata: { note: '全链演练交付', files: ['result.zip'] },
      artifact_urls: ['https://oss.mock/full-journey.zip'],
      submission_seq: 1,
    },
  );
  check('#13 交付提交 → in_accept', ok(deliv.status) && deliv.data?.status === 'submitted', JSON.stringify(deliv.data).slice(0, 120));

  // 4) 雇主验收（#14）
  const review = await req(M_API, `/longtask/employer/orders/${orderId}/review`, {
    method: 'POST',
    headers: aEmp,
    body: JSON.stringify({ action: 'accepted' }),
  });
  check('#14 雇主验收 accepted', ok(review.status) && review.data?.status === 'accepted', JSON.stringify(review.data).slice(0, 120));

  // 5) Console 触发结算（#31）
  const st = await contractReq('POST', `/v1/marketplace/orders/${orderId}/settlement/trigger`, {});
  check('#31 结算触发 → pending', ok(st.status) && st.data?.status === 'pending', JSON.stringify(st.data).slice(0, 120));

  // 6) 关联方回写结算完成（#32, ops）→ 工作室入账
  const sc = await contractReq(
    'POST',
    `/v1/marketplace/ops/orders/${orderId}/settlement-completed`,
    {},
  );
  check('#32 结算回写 → settled', ok(sc.status) && sc.data?.status === 'settled', JSON.stringify(sc.data).slice(0, 120));

  // 7) 资金校验：工作室 Owner 余额增加 ¥final_price（×100 分）
  const ownerBalanceAfter = (
    await client.query('SELECT available_cny FROM user_balances WHERE user_id = $1', [
      before.owner_user_id,
    ])
  ).rows[0]?.available_cny ?? 0;
  const expectIncome = (before.final_price_cny ?? 0) * 100;
  check(
    `划款：${before.ws_name} owner 余额 +¥${before.final_price_cny}（${ownerBalanceBefore}→${ownerBalanceAfter} 分）`,
    ownerBalanceAfter - ownerBalanceBefore === expectIncome,
    `delta=${ownerBalanceAfter - ownerBalanceBefore}`,
  );

  const after = (
    await client.query(
      'SELECT contract_status, delivery_status, settlement_status, payment_status FROM marketplace_orders WHERE id = $1',
      [orderId],
    )
  ).rows[0];
  console.log(
    `终态：contract=${after.contract_status} delivery=${after.delivery_status} settlement=${after.settlement_status} payment=${after.payment_status}`,
  );
}

await client.end();

function ok(s) {
  return s >= 200 && s < 300;
}
console.log(`\nFull-journey mock: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
