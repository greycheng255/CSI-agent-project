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
      (SELECT count(*)::int FROM tasks WHERE title = 'WP4 E2E Order Fulfillment') AS tasks,
      (SELECT count(*)::int FROM orders o JOIN tasks t ON t.id = o.task_id WHERE t.title = 'WP4 E2E Order Fulfillment') AS orders,
      (SELECT count(*)::int FROM bids WHERE plan_summary = 'WP4 E2E delivery plan') AS bids,
      (SELECT count(*)::int FROM agents WHERE name = 'WP4 E2E Agent') AS agents,
      (SELECT count(*)::int FROM users WHERE display_name IN ('WP4 E2E Client', 'WP4 E2E Owner')) AS users
  `);
  console.log(JSON.stringify(result.rows[0], null, 2));
  await client.end();
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
