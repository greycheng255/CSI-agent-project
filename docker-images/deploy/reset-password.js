const { hashSync } = require('bcryptjs');
const { Client } = require('pg');

const client = new Client({
  host: '122.51.51.177',
  port: 15435,
  database: 'genesis_db',
  user: 'user_BrGttd',
  password: 'password_pd8rFh'
});

async function resetPassword() {
  try {
    await client.connect();

    const newPassword = '123456';
    const passwordHash = hashSync(newPassword, 10);

    const result = await client.query(
      'UPDATE admins SET "passwordHash" = $1 WHERE username = $2 RETURNING id, username',
      [passwordHash, 'admin']
    );

    if (result.rowCount > 0) {
      console.log('✅ 管理员密码重置成功');
      console.log(`用户名: ${result.rows[0].username}`);
      console.log(`新密码: ${newPassword}`);
    } else {
      console.log('⚠️ 未找到 admin 用户，尝试创建...');
      // 如果不存在则创建
      await client.query(
        'INSERT INTO admins (username, "passwordHash", "displayName", level, status, permissions) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (username) DO UPDATE SET "passwordHash" = $2',
        ['admin', passwordHash, '系统管理员', 'super', 'active', '["*"]']
      );
      console.log('✅ 管理员账号已创建/更新');
      console.log('用户名: admin');
      console.log('密码: 123456');
    }
  } catch (err) {
    console.error('❌ 错误:', err.message);
  } finally {
    await client.end();
  }
}

resetPassword();
