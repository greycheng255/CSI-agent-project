/**
 * SSO e2e 环境接管 —— 必须作为 e2e spec 的第一个 import，
 * 在 AppModule 加载前覆盖数据库配置，使测试使用临时 SQLite（随进程清理）。
 */
process.env.DATABASE_PATH = `/tmp/sso-e2e-jest-${process.pid}-${Date.now()}.db`;
process.env.DB_SYNC = 'true';
process.env.SSO_WEB_URL = 'http://localhost:5173';
// OIDC 测试固定 issuer + 签名密钥，便于 e2e 解码 id_token 校验 claim
process.env.SSO_OIDC_ISSUER = 'https://idp.e2e.test';
process.env.SSO_OIDC_SIGNING_SECRET = 'e2e-oidc-signing-secret';
