const { Client } = require('pg');

const orderId = process.env.ORDER_ID;
if (!orderId) {
  console.error('ORDER_ID is required');
  process.exit(1);
}

const client = new Client({
  host: process.env.PGHOST || '122.51.51.177',
  port: Number(process.env.PGPORT || 15435),
  database: process.env.PGDATABASE || 'genesis_db',
  user: process.env.PGUSER || 'user_BrGttd',
  password: process.env.PGPASSWORD || 'password_pd8rFh',
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
});

function write(message, payload) {
  const line = `${new Date().toISOString()} ${message}${payload ? ` ${JSON.stringify(payload)}` : ''}\n`;
  require('fs').appendFileSync(require('path').resolve(__dirname, 'wp4-inspect-simple.log'), line);
  console.log(message, payload || '');
}

(async () => {
  write('connect:start');
  await client.connect();
  write('connect:ok');
  const order = await client.query(
    `SELECT id, status, platform_fee_cny, payout_cny, current_delivery_id
     FROM orders WHERE id = $1`,
    [orderId],
  );
  write('order:ok', order.rows[0] || null);
  const deliveryId = order.rows[0]?.current_delivery_id;
  const delivery = deliveryId
    ? await client.query(
        `SELECT id, status, artifact_urls, evidence_bundle ->> 'result' AS evidence_result, commit_hash
         FROM deliveries WHERE id = $1`,
        [deliveryId],
      )
    : { rows: [] };
  write('delivery:ok', delivery.rows[0] || null);
  const counts = await client.query(
    `SELECT
       (SELECT count(*)::int FROM delivery_revisions WHERE delivery_id = $2) AS revision_count,
       (SELECT count(*)::int FROM audit_logs WHERE entity_id = $1 AND action = 'FUNDS_RELEASE_APPROVED') AS release_approval_logs,
       (SELECT count(*)::int FROM audit_logs WHERE entity_id = $1 AND action = 'ORDER_STATUS_CHANGED') AS status_logs,
       (SELECT count(*)::int FROM execution_phases WHERE order_id = $1) AS phase_count,
       (SELECT count(*)::int FROM execution_traces WHERE order_id = $1) AS trace_count,
       (SELECT count(*)::int FROM balance_records WHERE order_id::text = $1::text) AS balance_records`,
    [orderId, deliveryId],
  );
  write('counts:ok', counts.rows[0] || null);

  console.log(JSON.stringify({
    order: order.rows[0] || null,
    delivery: delivery.rows[0] || null,
    counts: counts.rows[0] || null,
  }, null, 2));
  await client.end();
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
