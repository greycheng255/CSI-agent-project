const { Client } = require('pg');

const pgClient = new Client({
  host: process.env.DB_HOST || '122.51.51.177',
  port: process.env.DB_PORT || 15435,
  user: process.env.DB_USER || 'user_BrGttd',
  password: process.env.DB_PASSWORD || 'password_pd8rFh',
  database: process.env.DB_NAME || 'genesis_db'
});

async function checkOrders() {
  try {
    await pgClient.connect();
    console.log("=== 严格检查订单数据 ===\n");

    // 1. 查看订单表结构
    console.log("1. 订单表(orders)结构:");
    const colsRes = await pgClient.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'orders'
    `);
    colsRes.rows.forEach(col => {
      console.log(`   ${col.column_name}: ${col.data_type}`);
    });

    // 2. 查看所有订单原始数据
    console.log("\n2. 所有订单原始数据:");
    const ordersRes = await pgClient.query('SELECT * FROM orders');
    const orders = ordersRes.rows;
    console.log(`   订单总数: ${orders?.length || 0}`);
    if (orders && orders.length > 0) {
      orders.forEach((o, i) => {
        console.log(`\n   订单 ${i+1}:`);
        Object.keys(o).forEach(key => {
          console.log(`     ${key}: ${o[key]}`);
        });
      });
    } else {
      console.log("   (无订单数据)");
    }

    // 3. 查看所有用户
    console.log("\n3. 所有用户:");
    const usersRes = await pgClient.query('SELECT id, phone, role FROM users');
    const users = usersRes.rows;
    console.log(`   用户总数: ${users?.length || 0}`);
    if (users) {
      users.forEach(u => {
        console.log(`   - ID: ${u.id}, 手机号: ${u.phone}, 角色: ${u.role}`);
      });
    }

    // 4. 查看所有任务及其发布者
    console.log("\n4. 所有任务及其发布者:");
    const tasksRes = await pgClient.query('SELECT id, title, client_user_id, status FROM tasks');
    const tasks = tasksRes.rows;
    console.log(`   任务总数: ${tasks?.length || 0}`);
    if (tasks) {
      tasks.forEach(t => {
        console.log(`   - 任务ID: ${t.id}`);
        console.log(`     标题: ${t.title}`);
        console.log(`     发布者ID: ${t.client_user_id}`);
        console.log(`     状态: ${t.status}`);
      });
    }

    // 5. 检查关联关系
    console.log("\n5. 关联关系检查:");
    console.log("   订单.client_user_id 应该等于 任务.client_user_id");
    console.log("   订单.task_id 应该关联到 任务.id");

    await pgClient.end();
    console.log("\n=== 检查完成 ===");
  } catch (err) {
    console.error("错误:", err);
    process.exit(1);
  }
}

checkOrders();
