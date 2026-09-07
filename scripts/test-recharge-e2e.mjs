// 余额充值 / 支付宝支付 端到端测试（mock 模式）
// 覆盖两条充值链路：
//   Path A: POST /api/v1/balance/recharge          → recharge_orders (RCH 前缀)
//   Path B: POST /api/v1/payment/alipay/recharge    → payments (CSI 前缀, purpose=RECHARGE)
// mock 收银台：POST /api/v1/payments/alipay/mock/notify

import { execFileSync } from 'child_process';

const API_BASE = 'http://127.0.0.1:4001';
const PG = {
  host: '127.0.0.1', port: 15436,
  database: 'genesis_db', user: 'genesis_db', password: 'WHcWmDaySF3NXjtf',
};

// ---------- 简易 PG 查询（避免 psql 依赖） ----------
function pgQuery(sql, params = []) {
  const payload = JSON.stringify({ sql, params });
  const out = execFileSync('node', ['/workspace/scripts/db-helper.mjs'], {
    input: payload,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 5 * 1024 * 1024,
  }).toString().trim();
  try { return JSON.parse(out); } catch { return out; }
}

// ---------- HTTP ----------
async function http(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function yuan(fen) { return (fen / 100).toFixed(2); }

function banner(title) {
  console.log('\n' + '='.repeat(80));
  console.log(title);
  console.log('='.repeat(80));
}

// ---------- 主流程 ----------
const TEST_PHONE = '13800138001';
const DEBUG_SMS_CODE = '121212';

let totalPass = 0, totalFail = 0;
const issues = [];

function check(label, cond, extra = '') {
  if (cond) { console.log(`  ✓ ${label}`); totalPass++; }
  else { console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); totalFail++; issues.push(label); }
}

async function main() {
  banner('STEP 1: SMS 登录 (debug code)');
  const smsRes = await http('POST', '/api/v1/users/login/sms',
    { body: { phone: TEST_PHONE, verificationCode: DEBUG_SMS_CODE } });
  console.log('  status:', smsRes.status);
  const token = smsRes.data?.token;
  const userId = smsRes.data?.user?.id;
  check('登录返回 token', !!token, smsRes.data?.message || JSON.stringify(smsRes.data).slice(0, 200));
  check('登录返回 user.id', !!userId);
  if (!token || !userId) { console.log('登录失败，终止测试'); process.exit(1); }
  console.log('  user_id:', userId, 'phone:', smsRes.data?.user?.phone);

  // 清零状态
  pgQuery(`UPDATE user_balances SET available_cny=0, frozen_cny=0, total_income_cny=0, total_withdrawal_cny=0 WHERE user_id=$1`, [userId]);
  pgQuery(`DELETE FROM balance_records WHERE user_id=$1`, [userId]);

  // ========== Path A ==========
  banner('STEP 2A [Path A]: 创建充值单 — POST /api/v1/balance/recharge');
  const amountA = 500; // 5 元
  const createA = await http('POST', '/api/v1/balance/recharge',
    { token, body: { amountCny: amountA } });
  console.log('  status:', createA.status);
  console.log('  resp:', JSON.stringify(createA.data).slice(0, 400));
  const rechargeIdA = createA.data?.data?.rechargeId;
  const outTradeNoA = createA.data?.data?.outTradeNo;
  const paymentUrlA = createA.data?.data?.paymentUrl;
  check('返回 rechargeId', !!rechargeIdA);
  check('返回 outTradeNo (RCH 前缀)', outTradeNoA?.startsWith('RCH'), `got ${outTradeNoA}`);
  check('返回 paymentUrl (mock 收银台)', !!paymentUrlA && paymentUrlA.includes('mock'), `got ${paymentUrlA?.slice(0, 80)}`);

  // 数据库校验
  const rcA = pgQuery('SELECT status, amount_cny, trade_no, paid_at FROM recharge_orders WHERE id=$1', [rechargeIdA]);
  check('DB: recharge_orders.status=INIT', rcA[0]?.status === 'INIT', `got ${rcA[0]?.status}`);

  banner('STEP 3A [Path A]: 模拟支付宝 mock 回调 — POST /api/v1/payments/alipay/mock/notify');
  const mockA = await http('POST', '/api/v1/payments/alipay/mock/notify',
    { body: { out_trade_no: outTradeNoA, total_amount: yuan(amountA) } });
  console.log('  status:', mockA.status);
  console.log('  resp:', JSON.stringify(mockA.data).slice(0, 200));
  check('mock 回调成功', mockA.status === 200 && mockA.data?.success === true, mockA.data?.message || '');

  // 数据库校验
  const rcA2 = pgQuery('SELECT status, amount_cny, trade_no, paid_at, raw_notify FROM recharge_orders WHERE id=$1', [rechargeIdA]);
  check('DB: recharge_orders.status=PAID', rcA2[0]?.status === 'PAID', `got ${rcA2[0]?.status}`);
  check('DB: trade_no 已回填 (MOCK)', (rcA2[0]?.trade_no || '').startsWith('MOCK'), `got ${rcA2[0]?.trade_no}`);
  check('DB: paid_at 已回填', !!rcA2[0]?.paid_at, `got ${rcA2[0]?.paid_at}`);
  check('DB: raw_notify 已写入', !!rcA2[0]?.raw_notify, `got ${JSON.stringify(rcA2[0]?.raw_notify).slice(0, 50)}`);

  // 余额校验
  const balA = pgQuery('SELECT available_cny, total_income_cny FROM user_balances WHERE user_id=$1', [userId]);
  check('DB: user_balances.available_cny += 500', balA[0]?.available_cny === 500, `got ${balA[0]?.available_cny}`);
  check('DB: user_balances.total_income_cny += 500', balA[0]?.total_income_cny === 500, `got ${balA[0]?.total_income_cny}`);

  const recA = pgQuery(`SELECT "changeType", amount_cny, description FROM balance_records WHERE user_id=$1 ORDER BY created_at DESC LIMIT 3`, [userId]);
  console.log('  最近 balance_records:', JSON.stringify(recA).slice(0, 300));
  const depositRecA = recA.find(r => r.changeType === 'DEPOSIT');
  check('DB: balance_records 有 DEPOSIT 流水', !!depositRecA);
  check('DB: DEPOSIT 金额 = 500', depositRecA?.amount_cny === 500, `got ${depositRecA?.amount_cny}`);

  // 回调幂等：再次调用应该幂等返回
  banner('STEP 4A [Path A]: 幂等测试 — 再次 mock 回调');
  const mockA2 = await http('POST', '/api/v1/payments/alipay/mock/notify',
    { body: { out_trade_no: outTradeNoA, total_amount: yuan(amountA) } });
  console.log('  status:', mockA2.status);
  const balA2 = pgQuery('SELECT available_cny FROM user_balances WHERE user_id=$1', [userId]);
  check('幂等：余额不变', balA2[0]?.available_cny === 500, `got ${balA2[0]?.available_cny}`);

  // ========== Path B ==========
  banner('STEP 5B [Path B]: 创建充值支付单 — POST /api/v1/payments/alipay/recharge');
  const amountB = 800; // 8 元
  const createB = await http('POST', '/api/v1/payments/alipay/recharge',
    { token, body: { amountCny: amountB } });
  console.log('  status:', createB.status);
  console.log('  resp:', JSON.stringify(createB.data).slice(0, 400));
  const paymentIdB = createB.data?.data?.paymentId;
  const outTradeNoB = createB.data?.data?.outTradeNo;
  const paymentUrlB = createB.data?.data?.paymentUrl;
  check('返回 paymentId', !!paymentIdB);
  check('返回 outTradeNo (CSI 前缀)', outTradeNoB?.startsWith('CSI'), `got ${outTradeNoB}`);
  check('返回 paymentUrl (mock 收银台)', !!paymentUrlB && paymentUrlB.includes('mock'), `got ${paymentUrlB?.slice(0, 80)}`);

  // 数据库校验
  const payB = pgQuery('SELECT status, amount_cny, purpose, user_id, order_id, trade_no, paid_at FROM payments WHERE id=$1', [paymentIdB]);
  check('DB: payments.status=INIT', payB[0]?.status === 'INIT', `got ${payB[0]?.status}`);
  check('DB: payments.purpose=RECHARGE', payB[0]?.purpose === 'RECHARGE', `got ${payB[0]?.purpose}`);
  check('DB: payments.order_id IS NULL', payB[0]?.order_id === null, `got ${payB[0]?.order_id}`);
  check('DB: payments.user_id 已记录', payB[0]?.user_id === userId, `got ${payB[0]?.user_id}`);

  banner('STEP 6B [Path B]: 模拟支付宝 mock 回调 — POST /api/v1/payments/alipay/mock/notify');
  const mockB = await http('POST', '/api/v1/payments/alipay/mock/notify',
    { body: { out_trade_no: outTradeNoB, total_amount: yuan(amountB) } });
  console.log('  status:', mockB.status);
  console.log('  resp:', JSON.stringify(mockB.data).slice(0, 200));
  check('mock 回调成功', mockB.status === 200 && mockB.data?.success === true,
    mockB.data?.message || JSON.stringify(mockB.data).slice(0, 200));

  // 数据库校验 — 关键测试点：FOR UPDATE bug
  const payB2 = pgQuery('SELECT status, amount_cny, purpose, user_id, order_id, trade_no, paid_at, "rawNotify" FROM payments WHERE id=$1', [paymentIdB]);
  check('DB: payments.status=PAID', payB2[0]?.status === 'PAID', `got ${payB2[0]?.status}`);
  check('DB: trade_no 已回填 (MOCK)', (payB2[0]?.trade_no || '').startsWith('MOCK'), `got ${payB2[0]?.trade_no}`);
  check('DB: paid_at 已回填', !!payB2[0]?.paid_at, `got ${payB2[0]?.paid_at}`);
  check('DB: rawNotify 已写入', !!payB2[0]?.['rawNotify']);

  // 余额校验（应累加 Path A + Path B = 1300）
  const balB = pgQuery('SELECT available_cny, total_income_cny FROM user_balances WHERE user_id=$1', [userId]);
  check('DB: user_balances.available_cny = 1300 (500+800)', balB[0]?.available_cny === 1300, `got ${balB[0]?.available_cny}`);
  check('DB: user_balances.total_income_cny = 1300', balB[0]?.total_income_cny === 1300, `got ${balB[0]?.total_income_cny}`);

  // 余额流水
  const recB = pgQuery(`SELECT "changeType", amount_cny, description FROM balance_records WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5`, [userId]);
  console.log('  最近 balance_records:', JSON.stringify(recB).slice(0, 400));

  // 通知日志
  const notB = pgQuery(`SELECT notify_id, out_trade_no, trade_no, processed, failure_reason FROM payment_notification_logs WHERE out_trade_no=$1 ORDER BY created_at DESC`, [outTradeNoB]);
  console.log('  Path B payment_notification_logs:', JSON.stringify(notB).slice(0, 300));
  check('DB: 通知日志 processed=true',
    notB.some(n => n.processed === true), `got ${JSON.stringify(notB).slice(0, 200)}`);

  // 回调幂等
  banner('STEP 7B [Path B]: 幂等测试 — 再次 mock 回调');
  const mockB2 = await http('POST', '/api/v1/payments/alipay/mock/notify',
    { body: { out_trade_no: outTradeNoB, total_amount: yuan(amountB) } });
  console.log('  status:', mockB2.status);
  const balB2 = pgQuery('SELECT available_cny FROM user_balances WHERE user_id=$1', [userId]);
  check('幂等：余额不变', balB2[0]?.available_cny === 1300, `got ${balB2[0]?.available_cny}`);

  // ========== 异常路径 ==========
  banner('STEP 8: 异常路径测试');

  // 8.1 不存在的 outTradeNo
  const err1 = await http('POST', '/api/v1/payments/alipay/mock/notify',
    { body: { out_trade_no: 'RCHFAKEFAKEFAKE', total_amount: '5.00' } });
  check('不存在 outTradeNo → 404/400', err1.status === 404 || err1.status === 400, `got ${err1.status}`);

  // 8.2 Path B 跨用途：把 ORDER 类型的 payment 用 mock 回调（如有）
  // 此处不构造 order，跳过

  // 8.3 金额不匹配 — Path A
  const err2 = await http('POST', '/api/v1/payments/alipay/mock/notify',
    { body: { out_trade_no: outTradeNoA, total_amount: '999.99' } });
  // 旧 outTradeNo 已 PAID，会先返回 orderId（早返回），所以这里实际是 200 + 幂等
  console.log('  8.3 status:', err2.status, 'resp:', JSON.stringify(err2.data).slice(0, 150));

  // 8.4 重复金额 mock 路径 B 的新单 + 错金额
  const createC = await http('POST', '/api/v1/payments/alipay/recharge',
    { token, body: { amountCny: 300 } });
  const outTradeNoC = createC.data?.data?.outTradeNo;
  const err3 = await http('POST', '/api/v1/payments/alipay/mock/notify',
    { body: { out_trade_no: outTradeNoC, total_amount: '999.99' } });
  check('Path B 错金额 → 失败 (amount_mismatch)',
    err3.status === 500 || err3.status === 400 || err3.data?.success === false,
    `got ${err3.status} ${JSON.stringify(err3.data).slice(0, 100)}`);

  // ========== 小结 ==========
  banner('测试小结');
  console.log(`  通过: ${totalPass}   失败: ${totalFail}`);
  if (issues.length) {
    console.log('  失败项:');
    issues.forEach(s => console.log('    - ' + s));
  }
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(2); });
