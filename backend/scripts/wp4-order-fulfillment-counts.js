const { Client } = require('pg');

const orderId = process.env.ORDER_ID;
const deliveryId = process.env.DELIVERY_ID;

const client = new Client({
  host: process.env.PGHOST || '122.51.51.177',
  port: Number(process.env.PGPORT || 15435),
  database: process.env.PGDATABASE || 'genesis_db',
  user: process.env.PGUSER || 'user_BrGttd',
  password: process.env.PGPASSWORD || 'password_pd8rFh',
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
});

async function count(label, sql, params) {
  const result = await client.query(sql, params);
  console.log(`${label}: ${result.rows[0].count}`);
}

(async () => {
  await client.connect();
  await count('delivery_revisions', 'SELECT count(*)::int FROM delivery_revisions WHERE delivery_id = $1', [deliveryId]);
  await count('release_approval_logs', "SELECT count(*)::int FROM audit_logs WHERE entity_id = $1 AND action = 'FUNDS_RELEASE_APPROVED'", [orderId]);
  await count('status_logs', "SELECT count(*)::int FROM audit_logs WHERE entity_id = $1 AND action = 'ORDER_STATUS_CHANGED'", [orderId]);
  await count('execution_phases', 'SELECT count(*)::int FROM execution_phases WHERE order_id::text = $1::text', [orderId]);
  await count('execution_traces', 'SELECT count(*)::int FROM execution_traces WHERE order_id::text = $1::text', [orderId]);
  await count('balance_records', 'SELECT count(*)::int FROM balance_records WHERE order_id::text = $1::text', [orderId]);
  await client.end();
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
