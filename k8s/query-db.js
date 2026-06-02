const { Client } = require('pg');

const pgClient = new Client({
  host: process.env.DB_HOST || '122.51.51.177',
  port: process.env.DB_PORT || 15435,
  user: process.env.DB_USER || 'user_BrGttd',
  password: process.env.DB_PASSWORD || 'password_pd8rFh',
  database: process.env.DB_NAME || 'genesis_db'
});

async function queryDb() {
  try {
    await pgClient.connect();
    console.log("=== 查询数据库 ===\n");

    // 查询所有表
    const tablesRes = await pgClient.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    console.log("数据库中的表:");
    tablesRes.rows.forEach(t => console.log("  - " + t.table_name));
    console.log("");

    // 查询订单
    const ordersRes = await pgClient.query('SELECT * FROM orders');
    const orders = ordersRes.rows;
    console.log("=== 订单数据 ===");
    console.log("订单数量:", orders.length);

    if (orders.length === 0) {
      console.log("当前没有订单\n");
    } else {
      orders.forEach((o, i) => {
        console.log(`\n${i+1}. 订单ID: ${o.id}`);
        console.log(`   任务ID: ${o.task_id}`);
        console.log(`   订单client_user_id(雇主): ${o.client_user_id}`);
        console.log(`   订单owner_user_id(Agent所有者): ${o.owner_user_id}`);
        console.log(`   中标bid_id: ${o.bid_id}`);
        console.log(`   状态: ${o.status}`);
        console.log(`   金额: ${o.amount_cny}元`);
        console.log(`   创建时间: ${o.created_at}`);
      });
    }

    // 查询任务
    console.log("\n\n=== 任务数据 ===");
    const tasksRes = await pgClient.query('SELECT * FROM tasks LIMIT 10');
    const tasks = tasksRes.rows;
    console.log("任务数量:", tasks.length);
    tasks.forEach((t, i) => {
      console.log(`${i+1}. 任务ID: ${t.id}, 标题: ${t.title}, 发布者ID: ${t.client_user_id}, 状态: ${t.status}`);
    });

    // 查询用户
    console.log("\n\n=== 用户数据 ===");
    const usersRes = await pgClient.query('SELECT id, phone, role FROM users');
    const users = usersRes.rows;
    console.log("用户数量:", users.length);
    users.forEach((u, i) => {
      console.log(`${i+1}. 用户ID: ${u.id}, 手机号: ${u.phone}, 角色: ${u.role}`);
    });

    // 查询Agent
    console.log("\n\n=== Agent数据 ===");
    const agentsRes = await pgClient.query('SELECT * FROM agents LIMIT 10');
    const agents = agentsRes.rows;
    console.log("Agent数量:", agents.length);
    agents.forEach((a, i) => {
      console.log(`${i+1}. AgentID: ${a.id}, 名称: ${a.name}, 所有者ID: ${a.owner_user_id}`);
    });

    await pgClient.end();
    console.log("\n=== 查询完成 ===");
  } catch (err) {
    console.error("错误:", err);
    process.exit(1);
  }
}

queryDb();
