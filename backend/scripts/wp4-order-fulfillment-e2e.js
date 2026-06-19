const { Client } = require('pg');
const crypto = require('crypto');

const apiBase = process.env.API_BASE || 'http://127.0.0.1:4124';
const config = {
  host: process.env.PGHOST || process.env.DB_HOST || '122.51.51.177',
  port: Number(process.env.PGPORT || process.env.DB_PORT || 15435),
  database: process.env.PGDATABASE || process.env.DB_NAME || 'genesis_db',
  user: process.env.PGUSER || process.env.DB_USER || 'user_BrGttd',
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || 'password_pd8rFh',
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
};

const ids = {
  client: crypto.randomUUID(),
  owner: crypto.randomUUID(),
  agent: crypto.randomUUID(),
  task: crypto.randomUUID(),
  bid: crypto.randomUUID(),
  order: crypto.randomUUID(),
};

const evidenceBundle = {
  tests: ['npm test', 'wp4 smoke'],
  result: 'passed',
  generatedAt: new Date().toISOString(),
};

function logStep(message) {
  console.log(message);
  try {
    require('fs').appendFileSync(
      require('path').resolve(__dirname, 'wp4-e2e.log'),
      `${new Date().toISOString()} ${message}\n`,
    );
  } catch {}
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.HTTP_TIMEOUT_MS || 15000));
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  }).finally(() => clearTimeout(timer));
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && body.message
        ? body.message
        : `${res.status} ${res.statusText}`;
    const error = new Error(`${path} failed: ${message}`);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function seed(client) {
  await client.query(
    `INSERT INTO users (id, display_name, phone, email, password_hash, kyc_status, created_at)
     VALUES
       ($1, 'WP4 E2E Client', 'wp4-client', 'wp4-client@example.com', 'x', 'VERIFIED', now()),
       ($2, 'WP4 E2E Owner', 'wp4-owner', 'wp4-owner@example.com', 'x', 'VERIFIED', now())`,
    [ids.client, ids.owner],
  );
  await client.query(
    `INSERT INTO agents (
       id, owner_user_id, name, description, webhook_url, skills, status,
       created_at, updated_at, external_id, agent_mode, is_active,
       approval_status, runtime_status, visibility, version, agent_type
     )
     VALUES (
       $1, $2, 'WP4 E2E Agent', 'WP4 order fulfillment test agent',
       'https://example.com/wp4-webhook', ARRAY['wp4','delivery'], 'ONLINE',
       now(), now(), $3, 'external', true,
       'approved', 'online', 'public', '1.0.0', 'self-hosted'
     )`,
    [ids.agent, ids.owner, `wp4-e2e-${ids.agent}`],
  );
  await client.query(
    `INSERT INTO tasks (
       id, client_id, client_user_id, title, description, acceptance_criteria,
       budget_cny, tags, skills_required, attachment_urls, status, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, 'WP4 E2E Order Fulfillment',
       'Validate order fulfillment and structured delivery flow',
       '提交交付说明\n提供交付材料链接\n提供测试证据包',
       120, ARRAY['wp4'], ARRAY['delivery'], ARRAY['https://example.com/spec.pdf'],
       'OPEN', now(), now()
     )`,
    [ids.task, ids.client, ids.client],
  );
  await client.query(
    `INSERT INTO bids (
       id, task_id, agent_id, price_cny, plan_summary, pricing_model, pricing_meta,
       status, confidence_score, estimated_hours, risk_notes, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, 120, 'WP4 E2E delivery plan', 'fixed',
       '{"evaluation":{"executionPlan":["需求分析","交付实现","验收支持"]}}'::jsonb,
       'accepted', 0.95, 2, 'low', now(), now()
     )`,
    [ids.bid, ids.task, ids.agent],
  );
  await client.query(
    `INSERT INTO orders (
       id, task_id, bid_id, client_id, client_user_id, owner_id, owner_user_id,
       amount_cny, platform_fee_rate, status, delivery_count, max_delivery_attempts,
       created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 120, 0.10, 'PENDING_PAYMENT', 0, 3, now(), now())`,
    [ids.order, ids.task, ids.bid, ids.client, ids.client, ids.owner, ids.owner],
  );
}

async function cleanup(client) {
  await client.query('DELETE FROM audit_logs WHERE entity_id = $1', [ids.order]);
  await client.query('DELETE FROM balance_records WHERE order_id = $1', [ids.order]).catch(() => {});
  await client.query('DELETE FROM user_balances WHERE user_id IN ($1, $2)', [ids.client, ids.owner]).catch(() => {});
  await client.query('DELETE FROM delivery_revisions WHERE delivery_id IN (SELECT id FROM deliveries WHERE order_id = $1)', [ids.order]);
  await client.query('DELETE FROM deliveries WHERE order_id = $1', [ids.order]);
  await client.query('DELETE FROM acceptance_checklists WHERE order_id = $1', [ids.order]);
  await client.query('DELETE FROM execution_traces WHERE order_id = $1', [ids.order]);
  await client.query('DELETE FROM execution_sub_tasks WHERE phase_id IN (SELECT id FROM execution_phases WHERE order_id = $1)', [ids.order]);
  await client.query('DELETE FROM execution_phases WHERE order_id = $1', [ids.order]);
  await client.query('DELETE FROM orders WHERE id = $1', [ids.order]);
  await client.query('DELETE FROM bids WHERE id = $1', [ids.bid]);
  await client.query('DELETE FROM tasks WHERE id = $1', [ids.task]);
  await client.query('DELETE FROM agents WHERE id = $1', [ids.agent]);
  await client.query('DELETE FROM users WHERE id IN ($1, $2)', [ids.client, ids.owner]);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function adminLogin() {
  for (const password of ['123456', 'Qwer081213']) {
    try {
      const data = await request('/api/v1/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'admin', password }),
      });
      if (data.token) return data.token;
    } catch {}
  }
  throw new Error('admin login failed with tested passwords');
}

async function main() {
  const client = new Client(config);
  await client.connect();

  try {
    logStep('[WP4-E2E] cleanup old fixtures');
    await cleanup(client);
    logStep('[WP4-E2E] seed fixtures');
    await seed(client);

    const results = [];

    logStep('[WP4-E2E] order detail initial');
    const initialDetail = await request(`/api/v1/orders/${ids.order}`);
    assert(initialDetail.id === ids.order, 'order detail API did not return seeded order');
    assert(initialDetail.execution && Array.isArray(initialDetail.execution.phases), 'order detail missing execution snapshot');
    results.push('订单详情 API 返回 execution/delivery/checklist 扩展字段');

    logStep('[WP4-E2E] pay order');
    const paid = await request(`/api/v1/orders/${ids.order}/pay`, {
      method: 'POST',
      body: JSON.stringify({ userId: ids.client }),
    });
    assert(paid.status === 'IN_PROGRESS', 'pay did not move order to IN_PROGRESS');
    assert(paid.platformFeeCny === 12 && paid.payoutCny === 108, 'escrow fee/payout mismatch');
    results.push('支付托管接口流转 PENDING_PAYMENT -> IN_PROGRESS，金额拆分正确');

    logStep('[WP4-E2E] create execution plan');
    await request('/api/v1/execution/plans', {
      method: 'POST',
      body: JSON.stringify({
        orderId: ids.order,
        phases: [
          {
            phaseKey: 'analysis',
            name: '需求分析',
            description: '确认验收标准',
            weight: 40,
            sequence: 1,
            subTasks: [
              { taskKey: 'criteria', name: '验收标准确认', description: '确认验收项', weight: 100 },
            ],
          },
          {
            phaseKey: 'delivery',
            name: '交付实现',
            description: '产出交付物',
            weight: 60,
            sequence: 2,
            subTasks: [
              { taskKey: 'artifact', name: '生成交付材料', description: '生成报告和代码', weight: 100 },
            ],
          },
        ],
      }),
    });
    logStep('[WP4-E2E] report execution progress');
    await request('/api/v1/execution/progress/report', {
      method: 'POST',
      body: JSON.stringify({
        orderId: ids.order,
        progress: 35,
        event: 'PROGRESS',
        message: 'WP4 E2E execution progress',
        metadata: { stage: 'delivery' },
        reportedBy: 'wp4-e2e',
        componentType: 'AGENT',
      }),
    });
    logStep('[WP4-E2E] order detail with execution');
    const detailWithExecution = await request(`/api/v1/orders/${ids.order}`);
    assert(detailWithExecution.execution.phases.length === 2, 'order detail did not include execution phases');
    assert(detailWithExecution.execution.traces.length >= 1, 'order detail did not include execution trace');
    results.push('执行计划与进度上报后，订单详情可见真实 execution 快照');

    logStep('[WP4-E2E] submit structured delivery');
    const delivered = await request(`/api/v1/orders/${ids.order}/deliver`, {
      method: 'POST',
      body: JSON.stringify({
        userId: ids.owner,
        deliverySummary: 'WP4 E2E structured delivery',
        deliveryUrl: 'https://example.com/wp4-main-report.md',
        artifactUrls: [
          'https://example.com/wp4-main-report.md',
          'https://example.com/wp4-artifact.zip',
        ],
        evidenceBundle,
        commitHash: '9f4d2a1wp4e2e',
        previewData: {
          type: 'text',
          content: 'WP4 delivery preview',
        },
      }),
    });
    assert(delivered.order.status === 'DELIVERED', 'deliver did not move order to DELIVERED');
    assert(delivered.delivery.artifactUrls.length === 2, 'artifactUrls were not returned by deliver API');
    assert(delivered.delivery.commitHash === '9f4d2a1wp4e2e', 'commitHash was not returned by deliver API');
    results.push('交付接口写入结构化交付物并流转 IN_PROGRESS -> DELIVERED');

    logStep('[WP4-E2E] generate checklist');
    await request(`/api/v1/orders/${ids.order}/checklist/generate`, { method: 'POST' });
    let acceptBlocked = false;
    try {
      logStep('[WP4-E2E] accept should be blocked');
      await request(`/api/v1/orders/${ids.order}/accept`, {
        method: 'POST',
        body: JSON.stringify({ userId: ids.client }),
      });
    } catch (error) {
      acceptBlocked = error.status === 400;
    }
    assert(acceptBlocked, 'accept should be blocked while checklist is pending');
    results.push('验收清单未全通过时，accept 接口被后端拦截');

    logStep('[WP4-E2E] pass checklist');
    const checklist = await request(`/api/v1/orders/${ids.order}/checklist`);
    await request(`/api/v1/orders/${ids.order}/checklist/update`, {
      method: 'POST',
      body: JSON.stringify({
        userId: ids.client,
        items: checklist.map((item) => ({
          itemId: item.id,
          status: 'PASSED',
          comment: 'WP4 E2E passed',
        })),
      }),
    });
    logStep('[WP4-E2E] accept delivery');
    const accepted = await request(`/api/v1/orders/${ids.order}/accept`, {
      method: 'POST',
      body: JSON.stringify({ userId: ids.client }),
    });
    assert(accepted.status === 'PENDING_RELEASE', 'accept did not move order to PENDING_RELEASE');
    results.push('验收清单全通过后，accept 流转 DELIVERED -> PENDING_RELEASE');

    logStep('[WP4-E2E] admin login');
    const token = await adminLogin();
    logStep('[WP4-E2E] admin me');
    const admin = await request('/api/v1/admin/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    logStep('[WP4-E2E] release funds');
    const released = await request(`/api/v1/orders/${ids.order}/release`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        adminUserId: admin.id,
        transactionId: `wp4-e2e-${Date.now()}`,
        notes: 'WP4 E2E release',
      }),
    });
    assert(released.status === 'COMPLETED', 'release did not move order to COMPLETED');
    results.push('管理员放款接口流转 PENDING_RELEASE -> COMPLETED');

    logStep('[WP4-E2E] final db assertions');
    const db = await client.query(
      `SELECT
         o.status, o.platform_fee_cny, o.payout_cny, o.current_delivery_id,
         d.artifact_urls, d.evidence_bundle, d.commit_hash, d.status AS delivery_status,
         (SELECT count(*)::int FROM delivery_revisions WHERE delivery_id = d.id) AS revision_count,
         (SELECT count(*)::int FROM audit_logs WHERE entity_id = o.id AND action = 'FUNDS_RELEASE_APPROVED') AS release_approval_logs,
         (SELECT count(*)::int FROM audit_logs WHERE entity_id = o.id AND action = 'ORDER_STATUS_CHANGED') AS status_logs,
         (SELECT count(*)::int FROM execution_phases WHERE order_id::text = o.id::text) AS phase_count,
         (SELECT count(*)::int FROM execution_traces WHERE order_id::text = o.id::text) AS trace_count,
         (SELECT count(*)::int FROM balance_records WHERE order_id::text = o.id::text) AS balance_records
       FROM orders o
       JOIN deliveries d ON d.id = o.current_delivery_id
       WHERE o.id = $1`,
      [ids.order],
    );
    assert(db.rowCount === 1, 'final DB row not found');
    const row = db.rows[0];
    assert(row.status === 'COMPLETED', 'DB order status is not COMPLETED');
    assert(row.delivery_status === 'ACCEPTED', 'DB delivery status is not ACCEPTED');
    assert(row.artifact_urls.length === 2, 'DB artifact_urls mismatch');
    assert(row.evidence_bundle.result === 'passed', 'DB evidence_bundle mismatch');
    assert(row.commit_hash === '9f4d2a1wp4e2e', 'DB commit_hash mismatch');
    assert(row.revision_count >= 1, 'DB delivery revision missing');
    assert(row.release_approval_logs >= 1, 'DB release approval audit missing');
    assert(row.phase_count === 2 && row.trace_count >= 1, 'DB execution data missing');
    assert(row.balance_records >= 1, 'DB balance records missing');
    results.push('数据库落库校验通过：订单、交付、修订、执行、审计、余额记录完整');

    console.log(JSON.stringify({
      ok: true,
      apiBase,
      ids,
      results,
      finalDb: row,
    }, null, 2));
  } finally {
    if (process.env.KEEP_WP4_E2E_DATA === 'true') {
      logStep('[WP4-E2E] keep fixtures for inspection');
    } else {
      logStep('[WP4-E2E] cleanup fixtures');
      await cleanup(client);
    }
    await client.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    status: error.status,
    body: error.body,
    ids,
  }, null, 2));
  process.exitCode = 1;
});
