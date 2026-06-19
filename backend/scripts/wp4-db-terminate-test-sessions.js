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
    SELECT pid, left(query, 120) AS query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND (
        query ILIKE '%WP4 E2E%'
        OR query ILIKE '%delivery_revisions WHERE delivery_id%'
        OR query ILIKE '%execution_traces WHERE order_id%'
        OR query ILIKE '%execution_sub_tasks WHERE phase_id%'
        OR query ILIKE '%balance_records WHERE order_id%'
        OR query ILIKE '%deliveries WHERE order_id%'
        OR query ILIKE '%acceptance_checklists WHERE order_id%'
        OR query ILIKE '%DELETE FROM agents WHERE name = ''WP4 E2E Agent''%'
        OR query ILIKE '%DELETE FROM agents WHERE id = $1%'
        OR query ILIKE '%DELETE FROM agents WHERE id = ANY%'
      )
  `);
  for (const row of result.rows) {
    await client.query('SELECT pg_terminate_backend($1)', [row.pid]);
  }
  console.log(JSON.stringify({ terminated: result.rows }, null, 2));
  await client.end();
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
