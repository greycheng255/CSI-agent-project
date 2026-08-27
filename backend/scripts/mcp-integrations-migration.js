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
    `CREATE TABLE IF NOT EXISTS mcp_app_integrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR NOT NULL UNIQUE,
      name VARCHAR NOT NULL,
      description TEXT,
      direction VARCHAR NOT NULL DEFAULT 'bidirectional',
      transport VARCHAR NOT NULL DEFAULT 'streamable-http',
      endpoint_url VARCHAR,
      auth_mode VARCHAR NOT NULL DEFAULT 'none',
      auth_config_encrypted TEXT,
      default_workspace_id VARCHAR,
      default_tenant_id VARCHAR,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      health_status VARCHAR NOT NULL DEFAULT 'unknown',
      last_checked_at TIMESTAMP,
      last_discovered_at TIMESTAMP,
      last_synced_at TIMESTAMP,
      last_error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_app_integrations_code
      ON mcp_app_integrations(code)`,
    `ALTER TABLE mcp_app_integrations
      ADD COLUMN IF NOT EXISTS mcp_token_hash VARCHAR`,
    `ALTER TABLE mcp_app_integrations
      ADD COLUMN IF NOT EXISTS mcp_token_issued_at TIMESTAMP`,

    `CREATE TABLE IF NOT EXISTS mcp_app_tools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id UUID NOT NULL REFERENCES mcp_app_integrations(id) ON DELETE CASCADE,
      direction VARCHAR NOT NULL,
      name VARCHAR NOT NULL,
      description TEXT,
      input_schema JSONB,
      is_write BOOLEAN NOT NULL DEFAULT FALSE,
      requires_idempotency BOOLEAN NOT NULL DEFAULT FALSE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      last_seen_at TIMESTAMP,
      last_called_at TIMESTAMP,
      last_status VARCHAR,
      last_error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_app_tools_app_direction_name
      ON mcp_app_tools(app_id, direction, name)`,

    `CREATE TABLE IF NOT EXISTS mcp_app_capabilities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id UUID NOT NULL REFERENCES mcp_app_integrations(id) ON DELETE CASCADE,
      capability_type VARCHAR NOT NULL,
      code VARCHAR NOT NULL,
      name VARCHAR NOT NULL,
      description TEXT,
      schema_json JSONB,
      raw_json JSONB,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      last_synced_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_app_capabilities_app_type_code
      ON mcp_app_capabilities(app_id, capability_type, code)`,

    `CREATE TABLE IF NOT EXISTS mcp_app_tool_permissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id UUID NOT NULL REFERENCES mcp_app_integrations(id) ON DELETE CASCADE,
      tool_name VARCHAR NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      rate_limit_per_minute INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_app_tool_permissions_app_tool
      ON mcp_app_tool_permissions(app_id, tool_name)`,

    `CREATE TABLE IF NOT EXISTS mcp_app_invocations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id UUID NOT NULL REFERENCES mcp_app_integrations(id) ON DELETE CASCADE,
      direction VARCHAR NOT NULL,
      tool_name VARCHAR NOT NULL,
      request_json JSONB,
      response_json JSONB,
      status VARCHAR NOT NULL DEFAULT 'success',
      http_status INTEGER,
      content_type VARCHAR,
      duration_ms INTEGER,
      error_message TEXT,
      idempotency_key VARCHAR,
      platform_task_id UUID,
      platform_order_id UUID,
      external_task_id VARCHAR,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mcp_app_invocations_app_time
      ON mcp_app_invocations(app_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_mcp_app_invocations_tool
      ON mcp_app_invocations(tool_name)`,

    `CREATE TABLE IF NOT EXISTS mcp_task_bindings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id UUID NOT NULL REFERENCES mcp_app_integrations(id) ON DELETE CASCADE,
      platform_task_id UUID,
      platform_order_id UUID,
      external_task_id VARCHAR,
      external_tool_name VARCHAR,
      status VARCHAR,
      progress VARCHAR,
      result_url TEXT,
      result_json JSONB,
      cost NUMERIC,
      error_message TEXT,
      last_polled_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mcp_task_bindings_app_external
      ON mcp_task_bindings(app_id, external_task_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mcp_task_bindings_platform_task
      ON mcp_task_bindings(platform_task_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mcp_task_bindings_platform_order
      ON mcp_task_bindings(platform_order_id)`,
  ];

  for (const sql of statements) {
    await client.query(sql);
  }

  const result = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'mcp_app_integrations',
        'mcp_app_tools',
        'mcp_app_capabilities',
        'mcp_app_tool_permissions',
        'mcp_app_invocations',
        'mcp_task_bindings'
      )
    ORDER BY table_name
  `);

  console.table(result.rows);
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
