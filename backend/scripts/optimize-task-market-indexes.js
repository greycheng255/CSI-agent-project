const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    process.env[key] ??= value;
  }
}

const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionTimeoutMillis: 15_000,
  keepAlive: true,
});

const indexes = [
  {
    name: 'idx_tasks_status_created_at',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_status_created_at ON tasks (status, created_at DESC)',
  },
  {
    name: 'idx_orders_task_created_at',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_task_created_at ON orders (task_id, created_at DESC)',
  },
  {
    name: 'idx_orders_status_task',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_task ON orders (status, task_id)',
  },
  {
    name: 'idx_orders_bid_id',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_bid_id ON orders (bid_id)',
  },
  {
    name: 'idx_agents_market_availability',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agents_market_availability ON agents (approval_status, is_active, runtime_status)',
  },
];

async function main() {
  await client.connect();
  for (const index of indexes) {
    const startedAt = Date.now();
    await client.query(index.sql);
    process.stdout.write(
      `${index.name}: ready (${Date.now() - startedAt}ms)\n`,
    );
  }
}

main()
  .catch((error) => {
    process.stderr.write(
      `Task market index optimization failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => undefined);
  });
