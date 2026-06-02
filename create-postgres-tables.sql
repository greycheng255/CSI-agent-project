-- 创建 PostgreSQL 表结构（与 SQLite 兼容）

-- users 表
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR PRIMARY KEY NOT NULL,
    phone VARCHAR NOT NULL,
    nickname VARCHAR,
    avatar_url VARCHAR,
    status VARCHAR NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- access_tokens 表
CREATE TABLE IF NOT EXISTS access_tokens (
    id VARCHAR PRIMARY KEY NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMP,
    revoked_at TIMESTAMP,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id VARCHAR,
    CONSTRAINT uq_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_access_tokens_user FOREIGN KEY (user_id) REFERENCES users(id)
);

-- agents 表
CREATE TABLE IF NOT EXISTS agents (
    id VARCHAR PRIMARY KEY NOT NULL,
    name VARCHAR NOT NULL,
    description VARCHAR,
    webhook_url VARCHAR,
    skills TEXT,
    status VARCHAR NOT NULL DEFAULT 'OFFLINE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat_at TIMESTAMP,
    heartbeat_interval_ms INTEGER NOT NULL DEFAULT 30000,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    owner_user_id VARCHAR,
    pod_name VARCHAR,
    CONSTRAINT fk_agents_owner FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

-- agent_api_keys 表
CREATE TABLE IF NOT EXISTS agent_api_keys (
    id VARCHAR PRIMARY KEY NOT NULL,
    name TEXT,
    key_hash TEXT NOT NULL,
    revoked_at TIMESTAMP,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    agent_id VARCHAR,
    CONSTRAINT uq_key_hash UNIQUE (key_hash),
    CONSTRAINT fk_api_keys_agent FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- tasks 表
CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR PRIMARY KEY NOT NULL,
    title VARCHAR NOT NULL,
    description TEXT,
    acceptance_criteria TEXT,
    budget_cny INTEGER,
    expected_delivery_at TIMESTAMP,
    status VARCHAR NOT NULL DEFAULT 'DRAFT',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    client_user_id VARCHAR,
    CONSTRAINT fk_tasks_client FOREIGN KEY (client_user_id) REFERENCES users(id)
);

-- bids 表
CREATE TABLE IF NOT EXISTS bids (
    id VARCHAR PRIMARY KEY NOT NULL,
    price_cny INTEGER NOT NULL,
    plan_summary TEXT,
    pricing_model VARCHAR,
    pricing_meta JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    task_id VARCHAR,
    agent_id VARCHAR,
    CONSTRAINT fk_bids_agent FOREIGN KEY (agent_id) REFERENCES agents(id),
    CONSTRAINT fk_bids_task FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- orders 表
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR PRIMARY KEY NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'PENDING_PAYMENT',
    escrowed_at TIMESTAMP,
    delivered_at TIMESTAMP,
    released_at TIMESTAMP,
    platform_fee_cny INTEGER,
    payout_cny INTEGER,
    delivery_summary TEXT,
    delivery_url TEXT,
    dispute_reason TEXT,
    accepted_at TIMESTAMP,
    refunded_at TIMESTAMP,
    canceled_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    task_id VARCHAR,
    bid_id VARCHAR,
    client_user_id VARCHAR,
    owner_user_id VARCHAR,
    CONSTRAINT fk_orders_task FOREIGN KEY (task_id) REFERENCES tasks(id),
    CONSTRAINT fk_orders_bid FOREIGN KEY (bid_id) REFERENCES bids(id),
    CONSTRAINT fk_orders_client FOREIGN KEY (client_user_id) REFERENCES users(id),
    CONSTRAINT fk_orders_owner FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

-- deliveries 表
CREATE TABLE IF NOT EXISTS deliveries (
    id VARCHAR PRIMARY KEY NOT NULL,
    content TEXT,
    attachment_urls TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    order_id VARCHAR,
    CONSTRAINT fk_deliveries_order FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- arbitrations 表
CREATE TABLE IF NOT EXISTS arbitrations (
    id VARCHAR PRIMARY KEY NOT NULL,
    reason TEXT,
    status VARCHAR NOT NULL DEFAULT 'OPEN',
    resolution VARCHAR,
    resolved_by_admin_id TEXT,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    order_id VARCHAR,
    CONSTRAINT fk_arbitrations_order FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- audit_logs 表
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR PRIMARY KEY NOT NULL,
    entity_type VARCHAR NOT NULL,
    entity_id VARCHAR NOT NULL,
    action VARCHAR NOT NULL,
    old_value TEXT,
    new_value TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id VARCHAR,
    CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users(id)
);

-- webhook_deliveries 表
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id VARCHAR PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    webhook_url TEXT NOT NULL,
    payload TEXT,
    status VARCHAR NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    agent_id VARCHAR,
    CONSTRAINT fk_webhook_deliveries_agent FOREIGN KEY (agent_id) REFERENCES agents(id)
);
