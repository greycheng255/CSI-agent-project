const { Client } = require('pg');

const sql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_type varchar DEFAULT 'self-hosted';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS approval_status varchar DEFAULT 'draft';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS runtime_status varchar DEFAULT 'unknown';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS visibility varchar DEFAULT 'public';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS version varchar DEFAULT '1.0.0';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS card_url text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS endpoint_url text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS health_url text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS auth_type varchar DEFAULT 'bearer';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS pricing_model varchar DEFAULT 'quote';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS base_price numeric(10,2);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS currency varchar DEFAULT 'CNY';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS reputation_score numeric(3,2) DEFAULT 5.00;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS contact_email varchar;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE agents
SET agent_type = CASE
  WHEN agent_mode = 'kubernetes' THEN 'platform-managed'
  WHEN agent_mode = 'external' THEN 'self-hosted'
  ELSE COALESCE(agent_type, 'self-hosted')
END
WHERE agent_mode IS NOT NULL;

UPDATE agents
SET runtime_status = CASE
  WHEN status::text = 'ONLINE' THEN 'online'
  WHEN status::text = 'OFFLINE' THEN 'offline'
  ELSE COALESCE(runtime_status, 'unknown')
END
WHERE status IS NOT NULL;

ALTER TABLE agent_api_keys ADD COLUMN IF NOT EXISTS key_id varchar;
ALTER TABLE agent_api_keys ADD COLUMN IF NOT EXISTS scopes jsonb DEFAULT '["*"]'::jsonb;
ALTER TABLE agent_api_keys ADD COLUMN IF NOT EXISTS status varchar DEFAULT 'active';
ALTER TABLE agent_api_keys ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_api_keys_key_id ON agent_api_keys(key_id) WHERE key_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  key_id varchar NOT NULL UNIQUE,
  secret_hash varchar NOT NULL,
  scopes jsonb DEFAULT '["*"]'::jsonb,
  status varchar DEFAULT 'active',
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_agent_credentials_agent ON agent_credentials(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_credentials_key ON agent_credentials(key_id);

INSERT INTO agent_credentials (
  agent_id,
  key_id,
  secret_hash,
  scopes,
  status,
  expires_at,
  created_at,
  revoked_at
)
SELECT
  aak.agent_id,
  COALESCE(aak.key_id, 'ak_' || replace(aak.id::text, '-', '')),
  aak.key_hash,
  COALESCE(aak.scopes, '["*"]'::jsonb),
  CASE
    WHEN aak.revoked_at IS NOT NULL THEN 'revoked'
    WHEN aak.expires_at IS NOT NULL AND aak.expires_at < now() THEN 'expired'
    ELSE COALESCE(aak.status, 'active')
  END,
  aak.expires_at,
  aak.created_at,
  aak.revoked_at
FROM agent_api_keys aak
WHERE NOT EXISTS (
  SELECT 1
  FROM agent_credentials ac
  WHERE ac.secret_hash = aak.key_hash
     OR ac.key_id = COALESCE(aak.key_id, 'ak_' || replace(aak.id::text, '-', ''))
);

CREATE TABLE IF NOT EXISTS agent_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  schema_version varchar NOT NULL DEFAULT '1.0.0',
  version varchar NOT NULL,
  card_json jsonb NOT NULL,
  content_hash varchar NOT NULL,
  signature text,
  source varchar DEFAULT 'manual',
  is_active boolean DEFAULT true,
  fetched_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_cards_agent ON agent_cards(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_cards_active ON agent_cards(agent_id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS agent_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  capability_type varchar NOT NULL,
  name varchar NOT NULL,
  value jsonb,
  weight numeric(5,2) DEFAULT 1.00,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_agent ON agent_capabilities(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_type_name ON agent_capabilities(capability_type, name);

CREATE TABLE IF NOT EXISTS agent_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tag varchar NOT NULL,
  tag_type varchar DEFAULT 'custom',
  created_at timestamptz DEFAULT now(),
  CONSTRAINT uq_agent_tag UNIQUE(agent_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_agent_tags_agent ON agent_tags(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_tags_tag ON agent_tags(tag);

CREATE TABLE IF NOT EXISTS agent_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status varchar NOT NULL,
  latency_ms integer,
  load_metric numeric(5,2),
  metadata jsonb,
  reported_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_agent ON agent_heartbeats(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_time ON agent_heartbeats(reported_at DESC);

CREATE TABLE IF NOT EXISTS agent_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES agents(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id),
  action varchar NOT NULL,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_audit_logs_agent ON agent_audit_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_audit_logs_action ON agent_audit_logs(action);

CREATE TABLE IF NOT EXISTS agent_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  embedding_type varchar DEFAULT 'profile',
  text_content text NOT NULL,
  embedding text,
  model varchar,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_embeddings_agent ON agent_embeddings(agent_id);
`;

async function main() {
  const client = new Client({
    host: process.env.PGHOST || '122.51.51.177',
    port: Number(process.env.PGPORT || 15435),
    database: process.env.PGDATABASE || 'genesis_db',
    user: process.env.PGUSER || 'genesis_user',
    password: process.env.PGPASSWORD || 'genesis_password',
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    const check = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'agent_cards',
          'agent_capabilities',
          'agent_tags',
          'agent_heartbeats',
          'agent_audit_logs',
          'agent_embeddings',
          'agent_credentials'
        )
      ORDER BY table_name
    `);
    console.log('WP2 migration completed.');
    console.log('Created/verified tables:', check.rows.map((row) => row.table_name).join(', '));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('WP2 migration failed.');
  console.error(error);
  process.exit(1);
});
