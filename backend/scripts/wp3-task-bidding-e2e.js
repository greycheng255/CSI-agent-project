const { Client } = require('pg');
const crypto = require('crypto');

const API = process.env.API_BASE || 'http://localhost:4000';
const dbConfig = {
  host: process.env.PGHOST || '122.51.51.177',
  port: Number(process.env.PGPORT || 15435),
  database: process.env.PGDATABASE || 'genesis_db',
  user: process.env.PGUSER || 'user_BrGttd',
  password: process.env.PGPASSWORD || 'password_pd8rFh',
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${path} -> ${res.status}: ${text}`);
  }
  return data;
}

async function main() {
  const stamp = Date.now().toString().slice(-8);
  const phone = `139${stamp}`;
  const password = '123456';
  const client = new Client(dbConfig);
  await client.connect();

  try {
    console.log('1. register/login employer');
    await request('/api/v1/users/register', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        password,
        displayName: `WP3雇主${stamp}`,
      }),
    });
    const login = await request('/api/v1/users/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password }),
    });
    assert(login.token && login.user?.id, 'login should return token and user id');
    const userId = login.user.id;
    console.log(`   userId=${userId}`);

    console.log('2. prepare approved online agent and api key');
    const agentRow = await client.query(
      `
      SELECT id
      FROM agents
      WHERE owner_user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [userId],
    );
    assert(agentRow.rows[0]?.id, 'auto-created agent should exist for new user');
    const agentId = agentRow.rows[0].id;
    await client.query(
      `
      UPDATE agents
      SET approval_status = 'approved',
          runtime_status = 'online',
          status = 'ONLINE',
          is_active = true,
          skills = ARRAY['carbon-accounting','report-generation','mrv-review'],
          updated_at = NOW()
      WHERE id = $1
      `,
      [agentId],
    );
    const apiKey = `wp3_test_${crypto.randomBytes(18).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    await client.query(
      `
      INSERT INTO agent_credentials (agent_id, name, secret_hash, key_id, scopes, status, revoked_at, expires_at, last_used_at, created_at)
      VALUES ($1, 'WP3 E2E Key', $2, $3, '["bid:create","bid:update"]'::jsonb, 'active', NULL, NULL, NULL, NOW())
      `,
      [agentId, keyHash, `wp3-${stamp}`],
    );
    console.log(`   agentId=${agentId}`);

    console.log('3. create WP3 task through API');
    const task = await request('/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: `WP3链路验证任务-${stamp}`,
        description: '验证任务大厅筛选、Agent匹配、报价提交、报价排名和选标落库。',
        acceptanceCriteria: '任务可在大厅查询；报价可提交并被雇主选中；数据库状态正确。',
        budgetCny: 880,
        expectedDeliveryAt: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
        clientUserId: userId,
        tags: ['carbon-accounting', 'mrv-review'],
        skillsRequired: ['report-generation'],
        attachmentUrls: ['https://example.com/wp3-task-input.csv'],
      }),
    });
    assert(task.id, 'task should be created');
    console.log(`   taskId=${task.id}`);

    console.log('4. verify task market filters and real meta');
    const market = await request(
      `/api/v1/tasks/market?keyword=${encodeURIComponent('WP3链路验证任务')}&tags=carbon-accounting&minBudget=100&maxBudget=1000&sortBy=created_desc&limit=10`,
    );
    const marketTask = (market.data || []).find((item) => item.id === task.id);
    assert(marketTask, 'created task should be visible in market with filters');
    assert(Array.isArray(marketTask.tags) && marketTask.tags.includes('carbon-accounting'), 'market task should include tags');
    assert(typeof marketTask.matchedAgents === 'number', 'market task should include matchedAgents');
    console.log(`   market matchedAgents=${marketTask.matchedAgents}, bidsCount=${marketTask.bidsCount}`);

    console.log('5. submit bid with Agent API key');
    const bid = await request('/api/v1/agent/bids', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        taskId: task.id,
        priceCny: 520,
        planSummary: '使用碳核算与MRV能力完成数据清洗、核算和报告生成。',
        pricingModel: 'fixed',
        confidenceScore: 0.87,
        estimatedHours: 9,
        riskNotes: '需确认输入数据口径。',
      }),
    });
    assert(bid.id && bid.status === 'submitted', 'bid should be submitted');
    assert(Number(bid.confidenceScore) >= 0.86, 'bid should save confidenceScore');
    console.log(`   bidId=${bid.id}, status=${bid.status}`);

    console.log('6. verify ranked bid endpoint');
    const bids = await request(`/api/v1/tasks/${task.id}/bids`);
    const rankedBid = bids.find((item) => item.id === bid.id);
    assert(rankedBid, 'ranked bids should include submitted bid');
    assert(typeof rankedBid.rankScore === 'number', 'ranked bid should include rankScore');
    assert(rankedBid.estimatedHours === 9, 'ranked bid should include estimatedHours');
    console.log(`   rankScore=${rankedBid.rankScore}`);

    console.log('7. select bid and create order');
    const order = await request(`/api/v1/tasks/${task.id}/select-bid`, {
      method: 'POST',
      body: JSON.stringify({ bidId: bid.id, userId }),
    });
    assert(order.id && Number(order.amountCny) === 520, 'order should be created with bid amount');
    console.log(`   orderId=${order.id}`);

    console.log('8. verify database persistence');
    const persisted = await client.query(
      `
      SELECT
        t.id AS task_id,
        t.status AS task_status,
        t.tags,
        t.skills_required,
        t.attachment_urls,
        b.id AS bid_id,
        b.status AS bid_status,
        b.confidence_score,
        b.estimated_hours,
        b.risk_notes,
        o.id AS order_id,
        o.amount_cny
      FROM tasks t
      JOIN bids b ON b.task_id = t.id
      JOIN orders o ON o.bid_id = b.id
      WHERE t.id = $1 AND b.id = $2 AND o.id = $3
      `,
      [task.id, bid.id, order.id],
    );
    const row = persisted.rows[0];
    assert(row, 'task/bid/order should be persisted and linked');
    assert(row.task_status === 'CLOSED', `task should be CLOSED, got ${row.task_status}`);
    assert(row.bid_status === 'accepted', `bid should be accepted, got ${row.bid_status}`);
    assert(row.tags.includes('carbon-accounting'), 'task tags should persist');
    assert(row.skills_required.includes('report-generation'), 'task skills should persist');
    assert(row.attachment_urls.includes('https://example.com/wp3-task-input.csv'), 'task attachments should persist');
    console.log('   persisted row:', JSON.stringify(row, null, 2));

    console.log('WP3_E2E_PASS');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('WP3_E2E_FAIL');
  console.error(error);
  process.exitCode = 1;
});
