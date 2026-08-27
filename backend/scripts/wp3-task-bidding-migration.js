const { Client } = require('pg');

const config = {
  host: process.env.PGHOST || '122.51.51.177',
  port: Number(process.env.PGPORT || 15435),
  database: process.env.PGDATABASE || 'genesis_db',
  user: process.env.PGUSER || 'user_BrGttd',
  password: process.env.PGPASSWORD || 'password_pd8rFh',
};

const sql = `
BEGIN;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags TEXT[];
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS skills_required TEXT[];
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attachment_urls TEXT[];
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE bids ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'submitted';
ALTER TABLE bids ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(3,2) DEFAULT 0.50;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS estimated_hours INTEGER;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS risk_notes TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE bids SET status = 'submitted' WHERE status IS NULL;
UPDATE bids SET confidence_score = 0.50 WHERE confidence_score IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_tags ON tasks USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_tasks_skills_required ON tasks USING GIN (skills_required);
CREATE INDEX IF NOT EXISTS idx_bids_task_status ON bids (task_id, status);
CREATE INDEX IF NOT EXISTS idx_bids_agent_status ON bids (agent_id, status);

COMMIT;
`;

async function main() {
  const client = new Client(config);
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_name IN ('tasks', 'bids')
        AND column_name IN (
          'tags',
          'skills_required',
          'attachment_urls',
          'updated_at',
          'status',
          'confidence_score',
          'estimated_hours',
          'risk_notes'
        )
      ORDER BY table_name, column_name;
    `);
    console.table(rows);
    console.log('WP3 task bidding migration completed.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
