const { Client } = require('pg');

const client = new Client({
  host: process.env.PGHOST || '122.51.51.177',
  port: Number(process.env.PGPORT || 15435),
  database: process.env.PGDATABASE || 'genesis_db',
  user: process.env.PGUSER || 'user_BrGttd',
  password: process.env.PGPASSWORD || 'password_pd8rFh',
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
});

(async () => {
  await client.connect();
  const agents = await client.query("SELECT id, owner_user_id FROM agents WHERE name = 'WP4 E2E Agent'");
  const agentIds = agents.rows.map((row) => row.id);
  const ownerIds = agents.rows.map((row) => row.owner_user_id).filter(Boolean);

  if (agentIds.length > 0) {
    for (const table of [
      'agent_audit_logs',
      'agent_capabilities',
      'agent_cards',
      'agent_credentials',
      'agent_embeddings',
      'agent_heartbeats',
      'agent_tags',
    ]) {
      await client.query(`DELETE FROM ${table} WHERE agent_id = ANY($1::uuid[])`, [agentIds]);
    }
    await client.query('DELETE FROM agents WHERE id = ANY($1::uuid[])', [agentIds]);
  }

  const users = await client.query(
    "SELECT id FROM users WHERE display_name IN ('WP4 E2E Client', 'WP4 E2E Owner')",
  );
  const userIds = Array.from(new Set([...ownerIds, ...users.rows.map((row) => row.id)]));
  if (userIds.length > 0) {
    await client.query('DELETE FROM user_balances WHERE user_id = ANY($1::text[])', [userIds]);
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  }

  console.log(JSON.stringify({ deletedAgents: agentIds.length, deletedUsers: userIds.length }, null, 2));
  await client.end();
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
