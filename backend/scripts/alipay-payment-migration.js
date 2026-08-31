const fs = require('fs');
const path = require('path');

for (const envPath of [
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '..', 'frontend', '.env'),
]) {
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    process.env[key] ??= value;
  }
}

const sqliteStatements = `
  CREATE TABLE IF NOT EXISTS payment_notification_logs (
    id varchar PRIMARY KEY NOT NULL,
    provider varchar NOT NULL,
    source varchar NOT NULL,
    notify_id varchar(128),
    out_trade_no varchar(128),
    trade_no varchar(128),
    signature_valid boolean NOT NULL DEFAULT 0,
    processed boolean NOT NULL DEFAULT 0,
    failure_reason text,
    raw_payload text NOT NULL,
    client_ip varchar(128),
    processed_at datetime,
    created_at datetime NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_notify_provider_id
    ON payment_notification_logs(provider, notify_id);
  CREATE INDEX IF NOT EXISTS idx_payment_notify_trade_time
    ON payment_notification_logs(out_trade_no, created_at);
  CREATE INDEX IF NOT EXISTS idx_payments_order_time
    ON payments(order_id, created_at);
`;

const postgresStatements = [
  `CREATE TABLE IF NOT EXISTS payment_notification_logs (
    id UUID PRIMARY KEY,
    provider VARCHAR NOT NULL,
    source VARCHAR NOT NULL,
    notify_id VARCHAR(128),
    out_trade_no VARCHAR(128),
    trade_no VARCHAR(128),
    signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    failure_reason TEXT,
    raw_payload JSONB NOT NULL,
    client_ip VARCHAR(128),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_notify_provider_id
    ON payment_notification_logs(provider, notify_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_notify_trade_time
    ON payment_notification_logs(out_trade_no, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_order_time
    ON payments(order_id, created_at)`,
];

async function migratePostgres() {
  const { Client } = require('pg');
  const client = new Client({
    host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
    port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
    database: process.env.PGDATABASE || process.env.DB_NAME || 'genesis_db',
    user: process.env.PGUSER || process.env.DB_USER || 'genesis_user',
    password:
      process.env.PGPASSWORD ||
      process.env.DB_PASSWORD ||
      'genesis_password',
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const statement of postgresStatements) await client.query(statement);
    await client.query('COMMIT');
    console.log('Alipay payment tables migrated (PostgreSQL).');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

function migrateSqlite() {
  const Database = require('better-sqlite3');
  const databasePath = process.env.DATABASE_PATH || '/data/genesis.db';
  const database = new Database(databasePath);
  try {
    database.exec(sqliteStatements);
    console.log(`Alipay payment tables migrated (SQLite: ${databasePath}).`);
  } finally {
    database.close();
  }
}

const useSqlite = Boolean(process.env.DATABASE_PATH || !process.env.DB_HOST);
Promise.resolve(useSqlite ? migrateSqlite() : migratePostgres()).catch(
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
