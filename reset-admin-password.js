const { createHash } = require('crypto');
const { Client } = require('pg');

const client = new Client({
  host: 'genesis-db',
  port: 5432,
  database: 'genesis',
  user: 'postgres',
  password: 'postgres123'
});

async function resetPassword() {
  try {
    await client.connect();
    
    const newPassword = 'Qwer081213';
    const passwordHash = createHash('sha256').update(newPassword).digest('hex');
    
    const result = await client.query(
      'UPDATE admins SET "passwordHash" = $1 WHERE username = $2 RETURNING id, username',
      [passwordHash, 'admin']
    );
    
    if (result.rowCount > 0) {
      console.log('✅ 管理员密码重置成功');
      console.log(`用户名: ${result.rows[0].username}`);
      console.log(`新密码: ${newPassword}`);
    } else {
      console.log('⚠️ 未找到 admin 用户');
    }
  } catch (err) {
    console.error('错误:', err.message);
  } finally {
    await client.end();
  }
}

resetPassword();
