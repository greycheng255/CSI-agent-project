// WP-4 端到端测试: 订单履约 & 交付全流程
const h = require('http');
const post = (p, d, t) => new Promise(r => {
  const b = JSON.stringify(d);
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) };
  if (t) headers['Authorization'] = 'Bearer ' + t;
  const req = h.request({ hostname: 'localhost', port: 4000, path: p, method: 'POST', headers }, res => { let o = ''; res.on('data', c => o += c); res.on('end', () => r(JSON.parse(o))); });
  req.write(b); req.end();
});

async function test() {
  const { Client } = require('../node_modules/pg');
  const db = new Client({ host: '122.51.51.177', port: 15435, database: 'genesis_db', user: 'user_BrGttd', password: 'password_pd8rFh' });
  await db.connect();
  const cid = '551e8fe2-f567-4ed5-b71c-c02d77478717';

  // Activate agents
  await db.query("UPDATE agents SET runtime_status='online', status='ONLINE', last_heartbeat_at=NOW() WHERE approval_status='approved' AND is_active=true");
  console.log('🔄 Agents online');

  // 1. Task
  const t = await post('/api/v1/tasks', { title: 'E2E-WP4全流程', description: '端到端测试', acceptanceCriteria: '全部通过', budgetCny: 5000, clientUserId: cid });
  console.log('📋 Task: ' + t.id.substring(0, 8));

  // 2. Bid (activate agent right before)
  const login = await post('/api/v1/users/login', { phone: '13800000099', password: '123456' });
  const k = await post('/api/v1/owner/agents/1a659221-4221-40db-a6df-74b2104f5dea/api-keys', { name: 'e2e' }, login.token);
  if (!k.apiKey) throw new Error('Failed to get API key');
  // force activate this specific agent
  await db.query("UPDATE agents SET runtime_status='online', status='ONLINE', last_heartbeat_at=NOW() WHERE id='1a659221-4221-40db-a6df-74b2104f5dea'");
  const bid = await post('/api/v1/agent/bids', { taskId: t.id, priceCny: 4000, planSummary: '全栈方案,3天', pricingModel: 'fixed' }, k.apiKey);
  if (!bid.id) throw new Error('Bid failed: ' + JSON.stringify(bid).substring(0, 150));
  console.log('💰 Bid: ¥' + bid.priceCny);

  // 3. Order
  const o = await post('/api/v1/tasks/' + t.id + '/select-bid', { bidId: bid.id, userId: cid });
  const oid = o.id, owner = o.ownerUserId;
  console.log('📦 Order: ' + oid.substring(0, 8));

  // 4. Pay
  await post('/api/v1/orders/' + oid + '/pay', { userId: cid });
  console.log('💳 Pay ✅');

  // 5. Deliver v1
  const d1 = await post('/api/v1/orders/' + oid + '/deliver', {
    userId: owner,
    deliverySummary: 'v1:爬虫代码+CSV数据',
    deliveryUrl: 'https://cdn.example.com/v1.zip',
    artifactUrls: ['https://cdn.example.com/data.csv', 'https://cdn.example.com/code.py'],
    evidenceBundle: { log: 'https://logs.example.com/v1.log', screenshots: ['a.png', 'b.png'] },
    commitHash: 'abc1234def5678',
  });
  console.log('📨 Delivery v' + d1?.delivery?.version);

  // 6. Reject v1 (require revision)
  await post('/api/v1/orders/' + oid + '/reject', { userId: cid, reason: '数据格式需要JSON', requireRevision: true });
  console.log('🔁 Reject v1 → revision');

  // 7. Deliver v2 (improved)
  const d2 = await post('/api/v1/orders/' + oid + '/deliver', {
    userId: owner,
    deliverySummary: 'v2:JSON格式+测试报告',
    deliveryUrl: 'https://cdn.example.com/v2.zip',
    artifactUrls: ['https://cdn.example.com/data.json', 'https://cdn.example.com/code_v2.py', 'https://cdn.example.com/test.html'],
    evidenceBundle: { log: 'https://logs.example.com/v2.log', screenshots: ['v2-a.png', 'v2-b.png'] },
    commitHash: 'e8f9a2b3c4d5e6f7',
  });
  console.log('📨 Delivery v' + d2?.delivery?.version);

  // 8. Checklist + Accept
  const cl = await post('/api/v1/orders/' + oid + '/checklist/generate', {});
  const items = Array.isArray(cl) ? cl : [cl];
  for (const item of items) {
    await post('/api/v1/orders/' + oid + '/checklist/update', { userId: cid, items: [{ itemId: item.id, status: 'PASSED' }] });
  }
  await post('/api/v1/orders/' + oid + '/accept', { userId: cid });
  console.log('✅ Accept (' + items.length + ' items)');

  // 9. Release
  const adm = await post('/api/v1/admin/login', { username: 'admin', password: '123456' });
  await post('/api/v1/orders/' + oid + '/release', { adminUserId: 'ceb5c6c1-01d9-47bc-91a3-9819a78b0099', transactionId: 'E2E' }, adm.token);
  console.log('🏦 Release ✅');

  // 10. Verify
  const oRes = await db.query('SELECT status,amount_cny,platform_fee_cny,payout_cny,escrowed_at IS NOT NULL p,delivered_at IS NOT NULL d,accepted_at IS NOT NULL a,released_at IS NOT NULL r,delivery_count FROM orders WHERE id=$1', [oid]);
  const o2 = oRes.rows[0];
  const dRes = await db.query('SELECT version,delivery_text,array_length(artifact_urls,1)ac,evidence_bundle IS NOT NULL ev,commit_hash,status FROM deliveries WHERE order_id=$1 ORDER BY version', [oid]);
  const bRes = await db.query('SELECT amount_cny,\"changeType\",description FROM balance_records WHERE order_id=$1', [oid]);

  console.log('');
  console.log('═'.repeat(55));
  console.log('  WP-4 订单履约全流程 E2E 验证');
  console.log('═'.repeat(55));
  console.log('  Order: ' + oid.substring(0, 8) + ' | ' + o2.status);
  console.log('  金额 ¥' + o2.amount_cny + ' | 平台费 ¥' + o2.platform_fee_cny + ' | 开发者 ¥' + o2.payout_cny);
  console.log('  支付:' + (o2.p ? '✅' : '❌') + ' 交付:' + (o2.d ? '✅' : '❌') + ' 验收:' + (o2.a ? '✅' : '❌') + ' 放款:' + (o2.r ? '✅' : '❌'));
  console.log('  交付次数: ' + o2.delivery_count);
  dRes.rows.forEach(d => console.log('  v' + d.version + ': ' + d.status + ' artifacts=' + (d.ac || 0) + ' evidence=' + (d.ev ? '✅' : '❌') + ' commit=' + (d.commit_hash || 'none').substring(0, 10)));
  console.log('  余额变动:');
  bRes.rows.forEach(b => console.log('    ' + b.changeType + ' ¥' + b.amount_cny + ' - ' + b.description));

  const pass = o2.status === 'COMPLETED' && o2.p && o2.d && o2.a && o2.r && dRes.rows.length >= 2 && dRes.rows[1].ac >= 2 && dRes.rows[1].ev;
  console.log('');
  console.log('  ' + (pass ? '✅ WP-4 全部验收通过!' : '❌ 存在未完成项'));
  console.log('═'.repeat(55));
  db.end();
}
test().catch(e => console.error('FATAL:', e.message));
