/**
 * Schema drift repair: 对比实体期望列与远端 PG 实际列，幂等补齐缺失列。
 * 用法: node scripts/schema-drift-repair.js
 * 说明: 仅 ADD COLUMN IF NOT EXISTS，全部可空或带默认值，不修改已有列。
 */
const { Client } = require('pg');

const config = {
  host: process.env.PGHOST || '122.51.51.177',
  port: Number(process.env.PGPORT || 15435),
  database: process.env.PGDATABASE || 'genesis_db',
  user: process.env.PGUSER || 'user_BrGttd',
  password: process.env.PGPASSWORD || 'password_pd8rFh',
};

// 表 -> { 列名: 列定义（可空或带默认，幂等安全） }
const expected = {
  agents: {
    name: "VARCHAR NULL",
    description: "VARCHAR NULL",
    webhook_url: "VARCHAR NULL",
    skills: "TEXT[] NULL",
    status: "VARCHAR DEFAULT 'OFFLINE'",
    created_at: 'TIMESTAMPTZ DEFAULT NOW()',
    updated_at: 'TIMESTAMPTZ DEFAULT NOW()',
    last_heartbeat_at: 'TIMESTAMPTZ NULL',
    heartbeat_interval_ms: 'INT DEFAULT 30000',
    consecutive_failures: 'INT DEFAULT 0',
    pod_name: 'VARCHAR NULL',
    payment_qr_url: 'VARCHAR NULL',
    payment_qr_type: 'VARCHAR NULL',
    payment_account: 'VARCHAR NULL',
    openclaw_url: 'VARCHAR NULL',
    openclaw_status: "VARCHAR DEFAULT 'UNKNOWN'",
    last_health_check_at: 'TIMESTAMPTZ NULL',
    health_check_result: 'JSONB NULL',
    external_id: 'VARCHAR NULL',
    agent_mode: "VARCHAR DEFAULT 'kubernetes'",
    is_active: 'BOOLEAN DEFAULT true',
    agent_type: "VARCHAR DEFAULT 'self-hosted'",
    approval_status: "VARCHAR DEFAULT 'pending_review'",
    runtime_status: "VARCHAR DEFAULT 'unknown'",
    visibility: "VARCHAR DEFAULT 'public'",
    version: "VARCHAR DEFAULT '1.0.0'",
    card_url: 'TEXT NULL',
    endpoint_url: 'TEXT NULL',
    health_url: 'TEXT NULL',
    auth_type: "VARCHAR DEFAULT 'bearer'",
    pricing_model: "VARCHAR DEFAULT 'quote'",
    base_price: 'NUMERIC(10,2) NULL',
    currency: "VARCHAR DEFAULT 'CNY'",
    reputation_score: 'NUMERIC(3,2) DEFAULT 5.0',
    approved_at: 'TIMESTAMPTZ NULL',
    contact_email: 'VARCHAR NULL',
    metadata: 'JSONB NULL',
    owner_user_id: 'UUID NULL',
  },
  tasks: {
    client_user_id: 'VARCHAR NULL',
    client_id: 'UUID NULL',
    title: 'VARCHAR NULL',
    description: 'TEXT NULL',
    acceptance_criteria: 'TEXT NULL',
    budget_cny: 'INT NULL',
    expected_delivery_at: 'TIMESTAMPTZ NULL',
    tags: 'TEXT[] NULL',
    skills_required: 'TEXT[] NULL',
    attachment_urls: 'TEXT[] NULL',
    status: "VARCHAR DEFAULT 'DRAFT'",
    created_at: 'TIMESTAMPTZ DEFAULT NOW()',
    updated_at: 'TIMESTAMPTZ DEFAULT NOW()',
  },
  bids: {
    task_id: 'UUID NULL',
    agent_id: 'UUID NULL',
    price_cny: 'INT NULL',
    plan_summary: 'TEXT NULL',
    pricing_model: 'VARCHAR NULL',
    pricing_meta: 'JSONB NULL',
    status: "VARCHAR DEFAULT 'submitted'",
    confidence_score: 'NUMERIC(3,2) DEFAULT 0.5',
    estimated_hours: 'INT NULL',
    risk_notes: 'TEXT NULL',
    created_at: 'TIMESTAMPTZ DEFAULT NOW()',
    updated_at: 'TIMESTAMPTZ DEFAULT NOW()',
    expires_at: 'TIMESTAMP NULL',
  },
  orders: {
    task_id: 'UUID NULL',
    bid_id: 'UUID NULL',
    client_user_id: 'VARCHAR(255) NULL',
    client_id: 'UUID NULL',
    owner_user_id: 'VARCHAR(255) NULL',
    owner_id: 'UUID NULL',
    amount_cny: 'INT NULL',
    platform_fee_rate: 'NUMERIC(3,2) NULL',
    status: "VARCHAR DEFAULT 'PENDING_PAYMENT'",
    escrowed_at: 'TIMESTAMPTZ NULL',
    delivered_at: 'TIMESTAMPTZ NULL',
    released_at: 'TIMESTAMPTZ NULL',
    accepted_at: 'TIMESTAMPTZ NULL',
    refunded_at: 'TIMESTAMPTZ NULL',
    canceled_at: 'TIMESTAMPTZ NULL',
    platform_fee_cny: 'INT NULL',
    payout_cny: 'INT NULL',
    delivery_summary: 'TEXT NULL',
    delivery_url: 'TEXT NULL',
    dispute_reason: 'TEXT NULL',
    created_at: 'TIMESTAMPTZ DEFAULT NOW()',
    updated_at: 'TIMESTAMPTZ DEFAULT NOW()',
    current_delivery_id: 'UUID NULL',
    delivery_count: 'INT DEFAULT 0',
    max_delivery_attempts: 'INT DEFAULT 3',
  },
};

async function main() {
  const client = new Client(config);
  await client.connect();
  try {
    for (const [table, cols] of Object.entries(expected)) {
      const { rows } = await client.query(
        'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
        [table],
      );
      const existing = new Set(rows.map((r) => r.column_name));
      const missing = Object.keys(cols).filter((c) => !existing.has(c));
      if (missing.length === 0) {
        console.log(`${table}: ok (无缺失列)`);
        continue;
      }
      console.log(`${table}: 补齐缺失列 -> ${missing.join(', ')}`);
      for (const col of missing) {
        await client.query(
          `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${cols[col]}`,
        );
      }
    }
    console.log('Schema drift repair completed.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
