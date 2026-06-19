const { Client } = require('pg');

const config = {
  host: process.env.PGHOST || '122.51.51.177',
  port: Number(process.env.PGPORT || 15435),
  database: process.env.PGDATABASE || 'genesis_db',
  user: process.env.PGUSER || 'user_BrGttd',
  password: process.env.PGPASSWORD || 'password_pd8rFh',
};

async function main() {
  const client = new Client(config);
  await client.connect();

  const statements = [
    `ALTER TABLE deliveries
       ADD COLUMN IF NOT EXISTS artifact_urls text[]`,
    `ALTER TABLE deliveries
       ADD COLUMN IF NOT EXISTS evidence_bundle jsonb`,
    `ALTER TABLE deliveries
       ADD COLUMN IF NOT EXISTS commit_hash varchar`,
    `ALTER TABLE delivery_revisions
       ADD COLUMN IF NOT EXISTS artifact_urls text[]`,
    `ALTER TABLE delivery_revisions
       ADD COLUMN IF NOT EXISTS evidence_bundle jsonb`,
    `ALTER TABLE delivery_revisions
       ADD COLUMN IF NOT EXISTS commit_hash varchar`,
    `UPDATE deliveries
       SET artifact_urls = ARRAY[attachment_url]
       WHERE attachment_url IS NOT NULL
         AND btrim(attachment_url) <> ''
         AND artifact_urls IS NULL`,
    `UPDATE delivery_revisions
       SET artifact_urls = ARRAY[attachment_url]
       WHERE attachment_url IS NOT NULL
         AND btrim(attachment_url) <> ''
         AND artifact_urls IS NULL`,
  ];

  for (const sql of statements) {
    await client.query(sql);
  }

  const result = await client.query(`
    SELECT table_name, column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_name IN ('deliveries', 'delivery_revisions')
      AND column_name IN ('artifact_urls', 'evidence_bundle', 'commit_hash')
    ORDER BY table_name, column_name
  `);

  console.table(result.rows);
  await client.end();
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
