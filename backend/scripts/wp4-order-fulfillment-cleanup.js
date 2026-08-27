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

function log(message) {
  console.log(message);
  require('fs').appendFileSync(require('path').resolve(__dirname, 'wp4-cleanup.log'), `${new Date().toISOString()} ${message}\n`);
}

(async () => {
  log('connect:start');
  await client.connect();
  log('connect:ok');
  const orders = await client.query(`
    SELECT o.id, o.current_delivery_id, o.owner_user_id, o.client_user_id
    FROM orders o
    JOIN tasks t ON t.id = o.task_id
    WHERE t.title = 'WP4 E2E Order Fulfillment'
  `);
  const orderIds = orders.rows.map((row) => row.id);
  const deliveryIds = orders.rows.map((row) => row.current_delivery_id).filter(Boolean);
  const userIds = Array.from(new Set(orders.rows.flatMap((row) => [row.owner_user_id, row.client_user_id]).filter(Boolean)));

  log(`found orders=${orderIds.length} users=${userIds.length}`);
  if (orderIds.length > 0) {
    log('delete audit_logs');
    await client.query('DELETE FROM audit_logs WHERE entity_id = ANY($1::uuid[])', [orderIds]);
    log('delete balance_records');
    await client.query('DELETE FROM balance_records WHERE order_id = ANY($1::text[])', [orderIds]);
    if (deliveryIds.length > 0) {
      log('delete delivery_revisions');
      await client.query('DELETE FROM delivery_revisions WHERE delivery_id = ANY($1::uuid[])', [deliveryIds]);
    }
    log('delete deliveries');
    await client.query('DELETE FROM deliveries WHERE order_id = ANY($1::uuid[])', [orderIds]);
    log('delete acceptance_checklists');
    await client.query('DELETE FROM acceptance_checklists WHERE order_id = ANY($1::uuid[])', [orderIds]);
    log('delete execution_traces');
    await client.query('DELETE FROM execution_traces WHERE order_id = ANY($1::text[])', [orderIds]);
    log('delete execution_sub_tasks');
    await client.query('DELETE FROM execution_sub_tasks WHERE phase_id IN (SELECT id FROM execution_phases WHERE order_id = ANY($1::text[]))', [orderIds]);
    log('delete execution_phases');
    await client.query('DELETE FROM execution_phases WHERE order_id = ANY($1::text[])', [orderIds]);
    log('delete orders');
    await client.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [orderIds]);
  }

  log('delete bids');
  await client.query("DELETE FROM bids WHERE plan_summary = 'WP4 E2E delivery plan'");
  log('delete tasks');
  await client.query("DELETE FROM tasks WHERE title = 'WP4 E2E Order Fulfillment'");
  log('delete agents');
  await client.query("DELETE FROM agents WHERE name = 'WP4 E2E Agent'");
  if (userIds.length > 0) {
    log('delete user_balances');
    await client.query('DELETE FROM user_balances WHERE user_id = ANY($1::text[])', [userIds]);
    log('delete users');
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  }

  console.log(JSON.stringify({ deletedOrders: orderIds.length, deletedUsers: userIds.length }, null, 2));
  await client.end();
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
