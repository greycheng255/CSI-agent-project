const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    process.env[key] ??= value;
  }
}

const config = {
  host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
  port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
  database: process.env.PGDATABASE || process.env.DB_NAME || 'genesis_db',
  user: process.env.PGUSER || process.env.DB_USER || 'genesis_user',
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || 'genesis_password',
};

async function main() {
  const client = new Client(config);
  await client.connect();

  const statements = [
    `CREATE TABLE IF NOT EXISTS mcp_tool_invocations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tool_name VARCHAR NOT NULL,
      caller VARCHAR NOT NULL,
      request_id VARCHAR,
      idempotency_key VARCHAR,
      input_json JSONB,
      output_json JSONB,
      status VARCHAR DEFAULT 'success',
      error_message TEXT,
      duration_ms INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mcp_invocations_tool
      ON mcp_tool_invocations(tool_name)`,
    `CREATE INDEX IF NOT EXISTS idx_mcp_invocations_time
      ON mcp_tool_invocations(created_at DESC)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_idempotency
      ON mcp_tool_invocations(idempotency_key)
      WHERE idempotency_key IS NOT NULL`,
  ];

  for (const sql of statements) {
    await client.query(sql);
  }

  const result = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'mcp_tool_invocations'
    ORDER BY ordinal_position
  `);

  console.table(result.rows);
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
