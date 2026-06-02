const { Client } = require('pg');

const pgClient = new Client({
  host: process.env.DB_HOST || '122.51.51.177',
  port: process.env.DB_PORT || 15435,
  user: process.env.DB_USER || 'user_BrGttd',
  password: process.env.DB_PASSWORD || 'password_pd8rFh',
  database: process.env.DB_NAME || 'genesis_db'
});

async function checkAgents() {
  try {
    await pgClient.connect();
    console.log("=== 检查 Agent 数据 ===\n");

    // 查看所有 Agent
    const agentsRes = await pgClient.query('SELECT * FROM agents');
    const agents = agentsRes.rows;

    console.log(`Agent 总数: ${agents?.length || 0}\n`);

    if (agents && agents.length > 0) {
      agents.forEach((a, i) => {
        console.log(`Agent ${i + 1}:`);
        console.log(`  ID: ${a.id}`);
        console.log(`  名称: ${a.name}`);
        console.log(`  所有者ID: ${a.owner_user_id}`);
        console.log(`  状态: ${a.status}`);
        console.log(`  Webhook: ${a.webhook_url}`);
        console.log(`  创建时间: ${a.created_at}`);
        console.log("");
      });
    } else {
      console.log("数据库中没有 Agent 数据");
    }

    // 查看用户 13900000002 的 ID
    console.log("\n=== 查找用户 13900000002 的信息 ===");
    const userRes = await pgClient.query(
      'SELECT id, phone, role FROM users WHERE phone = $1',
      ['13900000002']
    );
    const user = userRes.rows[0];

    if (user) {
      console.log(`用户ID: ${user.id}`);
      console.log(`手机号: ${user.phone}`);
      console.log(`角色: ${user.role}`);

      // 查询该用户的 Agent
      console.log(`\n=== 查询该用户的 Agent ===`);
      const userAgentsRes = await pgClient.query(
        'SELECT * FROM agents WHERE owner_user_id = $1',
        [user.id]
      );
      const userAgents = userAgentsRes.rows;
      console.log(`该用户的 Agent 数量: ${userAgents?.length || 0}`);
      if (userAgents) {
        userAgents.forEach((a, i) => {
          console.log(`  ${i + 1}. ${a.name} (${a.id})`);
        });
      }
    } else {
      console.log("未找到用户 13900000002");
    }

    await pgClient.end();
  } catch (err) {
    console.error("错误:", err);
    process.exit(1);
  }
}

checkAgents();
