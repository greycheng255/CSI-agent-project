const { Client } = require('pg');

const pgClient = new Client({
  host: process.env.DB_HOST || '122.51.51.177',
  port: process.env.DB_PORT || 15435,
  user: process.env.DB_USER || 'user_BrGttd',
  password: process.env.DB_PASSWORD || 'password_pd8rFh',
  database: process.env.DB_NAME || 'genesis_db'
});

async function fixAgentOwner() {
  try {
    await pgClient.connect();
    console.log("=== 修改 Agent 的 owner ===\n");

    // 查看当前 Agent 的 owner
    console.log("当前 Agent 的 owner:");
    const agentsRes = await pgClient.query('SELECT id, name, owner_user_id FROM agents');
    agentsRes.rows.forEach(a => {
      console.log(`  ${a.name}: ${a.owner_user_id}`);
    });

    // 查看所有用户
    console.log("\n所有用户:");
    const usersRes = await pgClient.query('SELECT id, phone, role FROM users');
    usersRes.rows.forEach(u => {
      console.log(`  ${u.phone} (${u.role}): ${u.id}`);
    });

    console.log("\n请确认要将 Agent 的 owner 修改为哪个用户 ID");
    console.log("执行: node fix-agent-owner.js <new-owner-id>");

    await pgClient.end();
  } catch (err) {
    console.error("错误:", err);
    process.exit(1);
  }
}

fixAgentOwner();
