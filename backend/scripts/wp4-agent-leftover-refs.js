const { Client } = require('pg');

const client = new Client({
  host: process.env.PGHOST || '122.51.51.177',
  port: Number(process.env.PGPORT || 15435),
  database: process.env.PGDATABASE || 'genesis_db',
  user: process.env.PGUSER || 'user_BrGttd',
  password: process.env.PGPASSWORD || 'password_pd8rFh',
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
});

(async () => {
  await client.connect();
  const result = await client.query(`
    WITH a AS (SELECT id FROM agents WHERE name = 'WP4 E2E Agent')
    SELECT
      (SELECT count(*)::int FROM a) AS agents,
      (SELECT count(*)::int FROM agent_audit_logs WHERE agent_id IN (SELECT id FROM a)) AS audit_logs,
      (SELECT count(*)::int FROM agent_capabilities WHERE agent_id IN (SELECT id FROM a)) AS capabilities,
      (SELECT count(*)::int FROM agent_cards WHERE agent_id IN (SELECT id FROM a)) AS cards,
      (SELECT count(*)::int FROM agent_credentials WHERE agent_id IN (SELECT id FROM a)) AS credentials,
      (SELECT count(*)::int FROM agent_embeddings WHERE agent_id IN (SELECT id FROM a)) AS embeddings,
      (SELECT count(*)::int FROM agent_heartbeats WHERE agent_id IN (SELECT id FROM a)) AS heartbeats,
      (SELECT count(*)::int FROM agent_tags WHERE agent_id IN (SELECT id FROM a)) AS tags,
      (SELECT count(*)::int FROM bids WHERE agent_id IN (SELECT id FROM a)) AS bids
  `);
  console.log(JSON.stringify(result.rows[0], null, 2));
  await client.end();
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
