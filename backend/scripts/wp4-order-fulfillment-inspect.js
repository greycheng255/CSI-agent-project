const { Client } = require('pg');

const client = new Client({
  host: process.env.PGHOST || '122.51.51.177',
  port: Number(process.env.PGPORT || 15435),
  database: process.env.PGDATABASE || 'genesis_db',
  user: process.env.PGUSER || 'user_BrGttd',
  password: process.env.PGPASSWORD || 'password_pd8rFh',
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
});

(async () => {
  await client.connect();
  const result = await client.query(`
    SELECT
      o.id,
      o.status,
      o.platform_fee_cny,
      o.payout_cny,
      o.current_delivery_id,
      d.status AS delivery_status,
      d.artifact_urls,
      d.evidence_bundle,
      d.commit_hash,
      (SELECT count(*)::int FROM delivery_revisions WHERE delivery_id = d.id) AS revision_count,
      (SELECT count(*)::int FROM audit_logs WHERE entity_id = o.id AND action = 'FUNDS_RELEASE_APPROVED') AS release_approval_logs,
      (SELECT count(*)::int FROM audit_logs WHERE entity_id = o.id AND action = 'ORDER_STATUS_CHANGED') AS status_logs,
      (SELECT count(*)::int FROM execution_phases WHERE order_id = o.id) AS phase_count,
      (SELECT count(*)::int FROM execution_traces WHERE order_id = o.id) AS trace_count,
      (SELECT count(*)::int FROM balance_records WHERE order_id::text = o.id::text) AS balance_records
    FROM orders o
    JOIN tasks t ON t.id = o.task_id
    LEFT JOIN deliveries d ON d.id = o.current_delivery_id
    WHERE ($1::uuid IS NOT NULL AND o.id = $1::uuid)
       OR ($1::uuid IS NULL AND t.title = 'WP4 E2E Order Fulfillment')
    ORDER BY o.created_at DESC
    LIMIT 5
  `, [process.env.ORDER_ID || null]);
  console.log(JSON.stringify(result.rows, null, 2));
  await client.end();
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
