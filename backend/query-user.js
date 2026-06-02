const { Client } = require('pg');

const pgClient = new Client({
  host: process.env.DB_HOST || '122.51.51.177',
  port: process.env.DB_PORT || 15435,
  user: process.env.DB_USER || 'user_BrGttd',
  password: process.env.DB_PASSWORD || 'password_pd8rFh',
  database: process.env.DB_NAME || 'genesis_db'
});

async function queryUser() {
  try {
    await pgClient.connect();
    console.log("=== 查询数据库表结构 ===\n");

    // 查看 users 表结构
    const columnsRes = await pgClient.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'users'
    `);
    console.log("Users 表结构:");
    columnsRes.rows.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type}`);
    });

    // 查询所有用户
    console.log("\n=== 所有用户 ===");
    const usersRes = await pgClient.query('SELECT * FROM users');
    const users = usersRes.rows;
    console.log(`用户数量: ${users.length}\n`);
    users.forEach((u, i) => {
      console.log(`${i + 1}. 用户ID: ${u.id}`);
      // 打印所有字段
      Object.keys(u).forEach(key => {
        console.log(`   ${key}: ${u[key]}`);
      });
      console.log("");
    });

    // 查找手机号包含 13800000001 的用户
    console.log("\n=== 查找 13800000001 用户 ===");
    const targetUserRes = await pgClient.query(
      "SELECT * FROM users WHERE phone = $1",
      ['13800000001']
    );
    const targetUser = targetUserRes.rows[0];

    if (targetUser) {
      console.log("找到用户:", targetUser.id);

      // 查询该用户的任务
      console.log(`\n=== 查询该用户的任务 ===`);
      const tasksRes = await pgClient.query(
        'SELECT * FROM tasks WHERE client_user_id = $1',
        [targetUser.id]
      );
      const tasks = tasksRes.rows;
      console.log(`任务数量: ${tasks?.length || 0}`);
      if (tasks) {
        tasks.forEach((t, i) => {
          console.log(`${i + 1}. 任务ID: ${t.id}, 标题: ${t.title}, 状态: ${t.status}`);
        });
      }

      // 查询该用户的订单
      console.log(`\n=== 查询该用户的订单 ===`);
      const ordersRes = await pgClient.query(
        'SELECT * FROM orders WHERE client_user_id = $1',
        [targetUser.id]
      );
      const orders = ordersRes.rows;
      console.log(`订单数量: ${orders?.length || 0}`);
      if (orders && orders.length > 0) {
        orders.forEach((o, i) => {
          console.log(`${i + 1}. 订单ID: ${o.id}, 状态: ${o.status}, 金额: ${o.amount_cny}元`);
        });
      } else {
        console.log("该用户没有订单");
      }
    } else {
      console.log("未找到包含 13800000001 的用户");
    }

    await pgClient.end();
    console.log("\n=== 查询完成 ===");
  } catch (err) {
    console.error("错误:", err);
    process.exit(1);
  }
}

queryUser();
