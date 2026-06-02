const { Client } = require('pg');

const pgClient = new Client({
  host: process.env.DB_HOST || '122.51.51.177',
  port: process.env.DB_PORT || 15435,
  user: process.env.DB_USER || 'user_BrGttd',
  password: process.env.DB_PASSWORD || 'password_pd8rFh',
  database: process.env.DB_NAME || 'genesis_db'
});

async function deleteTasks() {
  try {
    await pgClient.connect();
    console.log("=== 删除所有任务 ===\n");

    // 先查看有多少任务
    const tasksRes = await pgClient.query('SELECT id, title FROM tasks');
    const tasks = tasksRes.rows;

    console.log(`当前任务数量: ${tasks.length}`);
    tasks.forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.id} - ${t.title}`);
    });

    if (tasks.length === 0) {
      console.log("\n没有任务需要删除");
      await pgClient.end();
      return;
    }

    // 删除所有投标
    console.log("\n删除相关投标...");
    const deleteBidsRes = await pgClient.query('DELETE FROM bids');
    console.log(`  删除了 ${deleteBidsRes.rowCount} 条投标记录`);

    // 删除所有任务
    console.log("删除所有任务...");
    const deleteTasksRes = await pgClient.query('DELETE FROM tasks');
    console.log(`  删除了 ${deleteTasksRes.rowCount} 条任务记录`);

    // 验证删除结果
    const countRes = await pgClient.query('SELECT COUNT(*) as count FROM tasks');
    console.log(`\n删除后任务数量: ${countRes.rows[0].count}`);

    await pgClient.end();
    console.log("\n=== 删除完成 ===");
  } catch (err) {
    console.error("错误:", err);
    process.exit(1);
  }
}

deleteTasks();
