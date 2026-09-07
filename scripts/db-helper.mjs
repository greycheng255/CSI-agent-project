// DB 查询小工具，stdin 读取 SQL+params(JSON)，stdout 输出 rows(JSON)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Client } = require('/workspace/backend/node_modules/pg');

const cfg = {
  host: '127.0.0.1', port: 15436,
  database: 'genesis_db', user: 'genesis_db', password: 'WHcWmDaySF3NXjtf',
};

const input = await new Promise((resolve) => {
  let buf = '';
  process.stdin.on('data', (c) => (buf += c));
  process.stdin.on('end', () => resolve(buf));
});
const { sql, params = [] } = JSON.parse(input);
const c = new Client(cfg);
try {
  await c.connect();
  const r = await c.query(sql, params);
  console.log(JSON.stringify(r.rows));
} catch (e) {
  console.error('PGERR:', e.message);
  process.exit(1);
} finally {
  await c.end();
}
