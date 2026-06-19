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
    SELECT
      pid,
      state,
      wait_event_type,
      wait_event,
      now() - query_start AS age,
      left(query, 160) AS query
    FROM pg_stat_activity
    WHERE datname = current_database()
    ORDER BY query_start NULLS LAST
  `);
  console.log(JSON.stringify(result.rows, null, 2));
  await client.end();
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
