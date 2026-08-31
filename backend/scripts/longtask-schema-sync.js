/**
 * 长任务线 13 张新表 DDL 同步脚本（幂等，PostgreSQL 15+）。
 * 用法：node scripts/longtask-schema-sync.js
 * 数据源：backend/.env（DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME）
 * 说明：只 CREATE TABLE IF NOT EXISTS，不触碰短任务线既有表（方案 A 双线独立）。
 */
const { Client } = require('pg');
const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');

// 读取 backend/.env（与 app.module.ts 同源）
for (const envPath of [resolve(__dirname, '..', '.env')]) {
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const sep = trimmed.indexOf('=');
      if (sep <= 0) continue;
      const key = trimmed.slice(0, sep).trim();
      const value = trimmed.slice(sep + 1).trim().replace(/^["']|["']$/g, '');
      process.env[key] ??= value;
    }
  }
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                UUID,
    name                  VARCHAR(255) NOT NULL,
    slug                  VARCHAR(255) NOT NULL UNIQUE,
    logo_url              TEXT,
    bio                   TEXT,
    category_ids          TEXT[],
    capability_tags       TEXT[],
    service_commitments   JSONB NOT NULL DEFAULT '{}',
    display_status        VARCHAR(32) NOT NULL DEFAULT 'active',
    receive_platform_push BOOLEAN NOT NULL DEFAULT TRUE,
    auto_bid_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    completed_tasks_count INT NOT NULL DEFAULT 0,
    avg_rating            NUMERIC(5,2) NOT NULL DEFAULT 0,
    on_time_rate          NUMERIC(7,4) NOT NULL DEFAULT 0,
    dispute_rate          NUMERIC(7,4) NOT NULL DEFAULT 0,
    showcase_cases        JSONB,
    announcement          VARCHAR(200),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS marketplace_tasks (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employer_user_id     UUID,
    title                VARCHAR(255) NOT NULL,
    description          TEXT,
    category_id          VARCHAR(64),
    budget_min_cny       INT,
    budget_max_cny       INT,
    expected_delivery_at TIMESTAMPTZ,
    attachment_urls      TEXT[],
    tags                 TEXT[],
    status               VARCHAR(32) NOT NULL DEFAULT 'draft',
    seat_limit           INT NOT NULL DEFAULT 20,
    seat_taken           INT NOT NULL DEFAULT 0,
    expires_at           TIMESTAMPTZ,
    seat_full_deadline   TIMESTAMPTZ,
    seat_full_locked_at  TIMESTAMPTZ,
    bid_round            INT NOT NULL DEFAULT 1,
    last_reopened_at     TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS opportunity_dispatches (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketplace_task_id UUID NOT NULL,
    workspace_id        UUID NOT NULL,
    bid_round           INT NOT NULL DEFAULT 1,
    mode                VARCHAR(16) NOT NULL,
    pushed_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (marketplace_task_id, workspace_id, bid_round, mode)
  )`,

  `CREATE TABLE IF NOT EXISTS marketplace_bids (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketplace_task_id  UUID NOT NULL,
    bid_round            INT NOT NULL,
    workspace_id         UUID NOT NULL,
    price_cny            INT NOT NULL,
    plan_summary         TEXT,
    estimated_delivery_at TIMESTAMPTZ,
    status               VARCHAR(16) NOT NULL DEFAULT 'submitted',
    source               VARCHAR(16) NOT NULL DEFAULT 'pull',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (marketplace_task_id, bid_round, workspace_id)
  )`,

  `CREATE TABLE IF NOT EXISTS marketplace_orders (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id           UUID UNIQUE,
    workspace_id         UUID NOT NULL,
    marketplace_task_id  UUID NOT NULL,
    bid_id               UUID,
    employer_user_id     UUID,
    final_price_cny      INT,
    contract_status      VARCHAR(32) NOT NULL DEFAULT 'signing',
    spec_snapshot        JSONB,
    spec_hash            TEXT,
    spec_version         INT NOT NULL DEFAULT 0,
    milestones           JSONB,
    delivery_status      VARCHAR(32),
    settlement_status    VARCHAR(32),
    after_sale_deadline  TIMESTAMPTZ,
    spec_deadline        TIMESTAMPTZ,
    spec_rejection_count INT NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS marketplace_cancel_requests (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       UUID NOT NULL,
    status         VARCHAR(32) NOT NULL DEFAULT 'open',
    "trigger"      VARCHAR(32),
    owner_response VARCHAR(32),
    resolution     VARCHAR(32),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS marketplace_deliveries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL,
    submission_seq  INT NOT NULL DEFAULT 1,
    metadata        JSONB,
    artifact_urls   JSONB,
    status          VARCHAR(24) NOT NULL DEFAULT 'submitted',
    review_round    INT NOT NULL DEFAULT 0,
    submitted_at    TIMESTAMPTZ,
    accept_deadline TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id, submission_seq)
  )`,

  `CREATE TABLE IF NOT EXISTS marketplace_revision_negotiations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id   UUID NOT NULL,
    status     VARCHAR(16) NOT NULL DEFAULT 'open',
    decision   VARCHAR(8),
    deadline   TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS marketplace_spec_changes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       UUID NOT NULL,
    change_seq     INT NOT NULL DEFAULT 1,
    classification VARCHAR(32),
    status         VARCHAR(16) NOT NULL DEFAULT 'requested',
    payload        JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id, change_seq)
  )`,

  `CREATE TABLE IF NOT EXISTS marketplace_settlements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            UUID NOT NULL UNIQUE,
    workspace_id        UUID NOT NULL,
    amount_cny          INT NOT NULL DEFAULT 0,
    milestone_breakdown JSONB,
    status              VARCHAR(24) NOT NULL DEFAULT 'pending',
    triggered_at        TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS marketplace_disputes (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id             UUID NOT NULL,
    status               VARCHAR(24) NOT NULL DEFAULT 'evidence_open',
    evidence_deadline    TIMESTAMPTZ,
    arbitration_deadline TIMESTAMPTZ,
    evidence             JSONB,
    resolution           VARCHAR(32),
    resolution_amount_cny INT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS webhook_outbox (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        VARCHAR(64) NOT NULL,
    event_type      VARCHAR(64) NOT NULL,
    target_url      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts        INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS inbound_webhook_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    VARCHAR(64) NOT NULL,
    event_type  VARCHAR(64) NOT NULL,
    payload     JSONB,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, event_type)
  )`,
];

async function main() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5436),
    user: process.env.DB_USER || 'genesis_user',
    password: process.env.DB_PASSWORD || 'genesis_password',
    database: process.env.DB_NAME || 'genesis_db',
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  console.log(`[schema-sync] connected: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);

  // 改造增量：workspaces 归属既有用户体系（agentMarket 卖方主体升级）
  await client.query(
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS owner_user_id UUID`,
  );
  console.log('[schema-sync] ALTER workspaces.owner_user_id OK（若已存在则跳过）');

  for (const ddl of DDL) {
    const tableName = ddl.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/)?.[1] ?? 'unknown';
    await client.query(ddl);
    console.log(`[schema-sync] OK  ${tableName}`);
  }

  // 汇总：13 张表行数与存在性
  const tables = DDL.map(
    (d) => d.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/)?.[1],
  ).filter(Boolean);
  for (const t of tables) {
    const res = await client.query(
      `SELECT to_regclass('public.${t}') IS NOT NULL AS exists, (SELECT count(*) FROM ${t}) AS rows`
        .replace(`SELECT count(*) FROM ${t}`, `SELECT count(*) FROM "${t}"`)
        .replace(`to_regclass('public.${t}')`, `to_regclass('public."${t}"')`),
    );
    console.log(`[schema-sync] ${t}: exists=${res.rows[0].exists} rows=${res.rows[0].rows}`);
  }

  await client.end();
  console.log('[schema-sync] done');
}

main().catch((err) => {
  console.error('[schema-sync] FAIL:', err.message);
  process.exit(1);
});