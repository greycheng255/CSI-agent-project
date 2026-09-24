ALTER TABLE agents ADD COLUMN IF NOT EXISTS approval_status VARCHAR DEFAULT 'pending_review';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS runtime_status VARCHAR DEFAULT 'unknown';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_type VARCHAR DEFAULT 'self-hosted';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS visibility VARCHAR DEFAULT 'public';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS version VARCHAR DEFAULT '1.0.0';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS card_url TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS endpoint_url TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS health_url TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS auth_type VARCHAR DEFAULT 'bearer';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS pricing_model VARCHAR DEFAULT 'quote';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS base_price DECIMAL(10,2);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS currency VARCHAR DEFAULT 'CNY';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS reputation_score DECIMAL(3,2) DEFAULT 5.00;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS contact_email VARCHAR;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
UPDATE agents SET approval_status='pending_review' WHERE approval_status IS NULL;
UPDATE agents SET runtime_status='unknown' WHERE runtime_status IS NULL;

-- SSO（Marketplace 作为 IdP）
ALTER TABLE access_tokens ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE access_tokens ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE access_tokens DROP CONSTRAINT IF EXISTS idx_access_tokens_token_hash;
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_tokens_token_hash ON access_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_access_tokens_user_client ON access_tokens(user_id, client_id);

CREATE TABLE IF NOT EXISTS sso_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT UNIQUE NOT NULL,
  client_secret_hash TEXT,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sso_authorization_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sso_auth_codes_code_hash ON sso_authorization_codes(code_hash);

-- 交付自动验收（PRD §9.4）：Gate 全过 + 5/9/13 天催办轨迹
ALTER TABLE marketplace_deliveries ADD COLUMN IF NOT EXISTS gates_all_passed BOOLEAN;
ALTER TABLE marketplace_deliveries ADD COLUMN IF NOT EXISTS reminder_days_sent INTEGER[] NOT NULL DEFAULT '{}';

-- LLM 计费单价表（人民币分 / 百万 tokens，输入/输出分开计价），管理员在线改价
CREATE TABLE IF NOT EXISTS llm_model_prices (
  model_name VARCHAR(128) PRIMARY KEY,
  input_price INT NOT NULL DEFAULT 0,
  output_price INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
