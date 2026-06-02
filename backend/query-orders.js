const { Client } = require('pg');

const pgClient = new Client({
  host: process.env.DB_HOST || '122.51.51.177',
  port: process.env.DB_PORT || 15435,
  user: process.env.DB_USER || 'user_BrGttd',
  password: process.env.DB_PASSWORD || 'password_pd8rFh',
  database: process.env.DB_NAME || 'genesis_db'
});

async function queryOrders() {
  try {
    await pgClient.connect();
    console.log("=== 查询数据库表结构 ===\n");

    // 查看所有表
    const tablesRes = await pgClient.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    console.log("数据库中的表:");
    tablesRes.rows.forEach(t => console.log(`  - ${t.table_name}`));

    // 查看 bids 表结构
    console.log("\n=== Bids 表结构 ===");
    const bidsColsRes = await pgClient.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'bids'
    `);
    bidsColsRes.rows.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type}`);
    });

    // 查询订单及其关联信息
    console.log("\n=== 订单列表 ===");
    const ordersRes = await pgClient.query(`
      SELECT
        o.id as order_id,
        o.status,
        o.amount_cny,
        o.created_at,
        o.task_id,
        o.bid_id,
        o.client_user_id,
        o.owner_user_id,
        t.title as task_title,
        t.client_user_id as task_user_id,
        b.agent_id,
        b.price_cny as bid_price
      FROM orders o
      LEFT JOIN tasks t ON o.task_id = t.id
      LEFT JOIN bids b ON o.bid_id = b.id
      ORDER BY o.created_at DESC
    `);
    const orders = ordersRes.rows;
    console.log(`找到 ${orders.length} 个订单\n`);

    if (orders.length === 0) {
      console.log("当前数据库中没有订单\n");
    } else {
      orders.forEach((o, i) => {
        console.log(`${i + 1}. 订单ID: ${o.order_id}`);
        console.log(`   状态: ${o.status}`);
        console.log(`   金额: ${o.amount_cny}元`);
        console.log(`   创建时间: ${o.created_at}`);
        console.log(`   --- 任务信息 ---`);
        console.log(`   任务ID: ${o.task_id || 'N/A'}`);
        console.log(`   任务标题: ${o.task_title || 'N/A'}`);
        console.log(`   任务发布者ID: ${o.task_user_id || 'N/A'}`);
        console.log(`   --- 订单关联用户 ---`);
        console.log(`   订单client_user_id(雇主): ${o.client_user_id || 'N/A'}`);
        console.log(`   订单owner_user_id(Agent所有者): ${o.owner_user_id || 'N/A'}`);
        console.log(`   --- 中标信息 ---`);
        console.log(`   中标ID: ${o.bid_id || 'N/A'}`);
        console.log(`   中标Agent ID: ${o.agent_id || 'N/A'}`);
        console.log(`   中标价格: ${o.bid_price || 'N/A'}元`);
        console.log("");
      });
    }

    // 查询所有任务
    console.log("\n=== 所有任务 ===");
    const tasksRes = await pgClient.query('SELECT id, title, client_user_id, status, budget_cny FROM tasks');
    const tasks = tasksRes.rows;
    console.log(`任务数量: ${tasks?.length || 0}`);
    if (tasks) {
      tasks.forEach((t, i) => {
        console.log(`${i + 1}. 任务ID: ${t.id}, 标题: ${t.title}, 发布者: ${t.client_user_id || 'N/A'}, 状态: ${t.status}, 预算: ${t.budget_cny}元`);
      });
    }

    // 查询所有Agent
    console.log("\n=== 所有Agent ===");
    const agentsRes = await pgClient.query('SELECT id, name, owner_user_id, status FROM agents');
    const agents = agentsRes.rows;
    console.log(`Agent数量: ${agents?.length || 0}`);
    if (agents) {
      agents.forEach((a, i) => {
        console.log(`${i + 1}. AgentID: ${a.id}, 名称: ${a.name}, 所有者: ${a.owner_user_id}, 状态: ${a.status}`);
      });
    }

    // 查询所有用户
    console.log("\n=== 所有用户 ===");
    const usersRes = await pgClient.query('SELECT id, phone, role FROM users');
    const users = usersRes.rows;
    console.log(`用户数量: ${users?.length || 0}`);
    if (users) {
      users.forEach((u, i) => {
        console.log(`${i + 1}. 用户ID: ${u.id}, 手机号: ${u.phone}, 角色: ${u.role}`);
      });
    }

    await pgClient.end();
    console.log("\n=== 查询完成 ===");
  } catch (err) {
    console.error("错误:", err);
    process.exit(1);
  }
}

queryOrders();
