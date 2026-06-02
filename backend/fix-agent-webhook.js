const { Client } = require('pg');

const pgClient = new Client({
  host: process.env.DB_HOST || '122.51.51.177',
  port: process.env.DB_PORT || 15435,
  user: process.env.DB_USER || 'user_BrGttd',
  password: process.env.DB_PASSWORD || 'password_pd8rFh',
  database: process.env.DB_NAME || 'genesis_db'
});

async function fixAgentWebhook() {
  try {
    await pgClient.connect();
    console.log("=== 修复 Agent Webhook URL ===\n");

    // 更新错误的 Agent webhook URL
    const wrongWebhookPattern = 'genesis-agent-369254f6-6a20-4bd0-a221-5a0606e0759a.genesis.svc.cluster.local';
    const correctWebhook = 'http://genesis-agent.genesis.svc.cluster.local:3000/webhook';

    const result = await pgClient.query(
      `UPDATE agents 
       SET webhook_url = $1 
       WHERE webhook_url LIKE $2 
       RETURNING id, name, webhook_url`,
      [correctWebhook, `%${wrongWebhookPattern}%`]
    );

    if (result.rows.length > 0) {
      console.log(`✅ 已修复 ${result.rows.length} 个 Agent:`);
      result.rows.forEach(agent => {
        console.log(`  - ID: ${agent.id}`);
        console.log(`  - 名称: ${agent.name}`);
        console.log(`  - 新 Webhook: ${agent.webhook_url}`);
      });
    } else {
      console.log("没有找到需要修复的 Agent");
    }

    // 显示所有 Agent 的当前配置
    console.log("\n=== 当前所有 Agent 配置 ===");
    const allAgents = await pgClient.query('SELECT id, name, webhook_url, status FROM agents');
    allAgents.rows.forEach(agent => {
      console.log(`\n${agent.name}:`);
      console.log(`  ID: ${agent.id}`);
      console.log(`  Webhook: ${agent.webhook_url}`);
      console.log(`  状态: ${agent.status}`);
    });

  } catch (error) {
    console.error('❌ 修复失败:', error.message);
  } finally {
    await pgClient.end();
  }
}

fixAgentWebhook();
