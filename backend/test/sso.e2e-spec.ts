import './sso-e2e-env'; // 必须第一个导入：在 AppModule 之前接管数据库环境
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { createHash, randomBytes } from 'crypto';
import { unlinkSync } from 'fs';

jest.setTimeout(180000); // 完整 AppModule 启动较慢

const API = '/api/v1';

/** 通过短信验证码（debug 码 121212）创建/登录用户，返回 Bearer token */
async function smsLogin(server: any, phone: string): Promise<string> {
  const res = await request(server)
    .post(`${API}/users/login/sms`)
    .send({ phone, verificationCode: '121212' })
    .expect(201);
  return res.body.token as string;
}

describe('SsoController (e2e)', () => {
  let app: INestApplication<App>;
  const dbPath = process.env.DATABASE_PATH!;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    try {
      unlinkSync(dbPath);
    } catch {
      // 临时库清理失败不影响测试结果
    }
  });

  it('GET /sso/authorize 校验通过后 302 到前端授权页并透传参数', () => {
    return request(app.getHttpServer())
      .get('/api/v1/sso/authorize')
      .query({
        client_id: 'openclaw-cli',
        redirect_uri: 'http://127.0.0.1:53741/callback',
        state: 'st-e2e',
      })
      .expect(302)
      .expect((res) => {
        const location = res.headers.location as string;
        expect(location).toContain('http://localhost:5173/sso/authorize');
        expect(location).toContain('client_id=openclaw-cli');
        expect(location).toContain('state=st-e2e');
      });
  });
});

describe('SsoController 授权码流程 (e2e)', () => {
  let app: INestApplication<App>;
  const dbPath = process.env.DATABASE_PATH!;
  const phone = `137${String(Date.now()).slice(-8)}`;
  const redirectUri = 'http://127.0.0.1:53741/callback';

  let userToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    userToken = await smsLogin(app.getHttpServer(), phone);
  });

  afterAll(async () => {
    await app.close();
    try {
      unlinkSync(dbPath);
    } catch {
      // 临时库清理失败不影响测试结果
    }
  });

  /** 为当前用户签发授权码 */
  const issueCode = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`${API}/sso/authorize`)
      .set('Authorization', `Bearer ${userToken}`)
      .send(body);

  it('POST /sso/authorize 为已登录用户签发授权码', async () => {
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    const res = await issueCode({
      client_id: 'openclaw-cli',
      redirect_uri: redirectUri,
      state: 'flow-state',
      code_challenge: challenge,
    }).expect(201);

    expect(res.body.code).toBeTruthy();
    expect(res.body.state).toBe('flow-state');
    expect(res.body.redirect_uri).toBe(redirectUri);
  });

  it('POST /sso/authorize 未登录返回 401', () => {
    return request(app.getHttpServer())
      .post(`${API}/sso/authorize`)
      .send({
        client_id: 'openclaw-cli',
        redirect_uri: redirectUri,
      })
      .expect(401);
  });

  it('POST /sso/authorize redirect_uri 不在白名单返回 400', () => {
    return issueCode({
      client_id: 'openclaw-cli',
      redirect_uri: 'https://evil.example.com/callback',
    }).expect(400);
  });

  it('授权码 + PKCE 换 token → userinfo，重放拒绝', async () => {
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    const { body } = await issueCode({
      client_id: 'openclaw-cli',
      redirect_uri: redirectUri,
      code_challenge: challenge,
    }).expect(201);

    // 授权码换 token
    const exchange = await request(app.getHttpServer())
      .post(`${API}/sso/token`)
      .send({
        grant_type: 'authorization_code',
        code: body.code,
        client_id: 'openclaw-cli',
        code_verifier: verifier,
        redirect_uri: redirectUri,
      })
      .expect(201);

    expect(exchange.body.access_token).toBeTruthy();
    expect(exchange.body.token_type).toBe('Bearer');
    expect(exchange.body.user.phone).toBe(phone);

    // userinfo
    const userinfo = await request(app.getHttpServer())
      .get(`${API}/sso/userinfo`)
      .set('Authorization', `Bearer ${exchange.body.access_token}`)
      .expect(200);
    expect(userinfo.body.id).toBe(exchange.body.user.id);

    // code 重放被拒
    await request(app.getHttpServer())
      .post(`${API}/sso/token`)
      .send({
        grant_type: 'authorization_code',
        code: body.code,
        client_id: 'openclaw-cli',
        code_verifier: verifier,
        redirect_uri: redirectUri,
      })
      .expect(400);
  });

  it('PKCE verifier 错误返回 400', async () => {
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    const { body } = await issueCode({
      client_id: 'openclaw-cli',
      redirect_uri: redirectUri,
      code_challenge: challenge,
    }).expect(201);

    await request(app.getHttpServer())
      .post(`${API}/sso/token`)
      .send({
        grant_type: 'authorization_code',
        code: body.code,
        client_id: 'openclaw-cli',
        code_verifier: 'wrong-verifier',
        redirect_uri: redirectUri,
      })
      .expect(400);
  });
});

describe('SsoController 登出与 PAT (e2e)', () => {
  let app: INestApplication<App>;
  const dbPath = process.env.DATABASE_PATH!;
  const phone = `136${String(Date.now()).slice(-8)}`;
  const redirectUri = 'http://127.0.0.1:54001/callback';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    try {
      unlinkSync(dbPath);
    } catch {
      // 临时库清理失败不影响测试结果
    }
  });

  const me = (token: string) =>
    request(app.getHttpServer())
      .get(`${API}/users/me`)
      .set('Authorization', `Bearer ${token}`);

  /** 签发一个 SSO token（openclaw-cli 客户端） */
  const issueSsoToken = async (userToken: string): Promise<string> => {
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const { body } = await request(app.getHttpServer())
      .post(`${API}/sso/authorize`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ client_id: 'openclaw-cli', redirect_uri: redirectUri, code_challenge: challenge })
      .expect(201);
    const exchange = await request(app.getHttpServer())
      .post(`${API}/sso/token`)
      .send({
        grant_type: 'authorization_code',
        code: body.code,
        client_id: 'openclaw-cli',
        code_verifier: verifier,
        redirect_uri: redirectUri,
      })
      .expect(201);
    return exchange.body.access_token as string;
  };

  it('POST /users/logout 仅撤销当前令牌（单设备登出）', async () => {
    const server = app.getHttpServer();
    const tokenA = await smsLogin(server, phone);
    const tokenB = await smsLogin(server, phone);

    await request(server)
      .post(`${API}/users/logout`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);

    await me(tokenA).expect(401);
    await me(tokenB).expect(200);
  });

  it('POST /sso/logout 全局登出撤销登录+SSO 令牌，PAT 保留', async () => {
    const server = app.getHttpServer();
    const tokenB = await smsLogin(server, phone);
    const ssoToken = await issueSsoToken(tokenB);
    const pat = (
      await request(server)
        .post(`${API}/users/pat`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'e2e-pat' })
        .expect(201)
    ).body.token as string;

    const logout = await request(server)
      .post(`${API}/sso/logout`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({})
      .expect(201);
    expect(logout.body.revoked).toBeGreaterThanOrEqual(2); // 至少：当前登录令牌 + SSO 令牌

    await me(tokenB).expect(401);
    await request(server)
      .get(`${API}/sso/userinfo`)
      .set('Authorization', `Bearer ${ssoToken}`)
      .expect(401);
    // PAT 不受全局登出影响
    await request(server)
      .get(`${API}/sso/userinfo`)
      .set('Authorization', `Bearer ${pat}`)
      .expect(200);
  });

  it('POST /sso/logout 定向登出仅撤销指定 client 的令牌', async () => {
    const server = app.getHttpServer();
    const token = await smsLogin(server, phone);

    await request(server)
      .post(`${API}/sso/logout`)
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 'openclaw-cli' })
      .expect(201)
      .expect((res) => expect(res.body.revoked).toBe(0));

    // 普通登录令牌（无 client_id）不受定向登出影响
    await me(token).expect(200);
  });

  it('PAT 创建后仅返回一次，撤销后立即失效', async () => {
    const server = app.getHttpServer();
    const token = await smsLogin(server, phone);

    const created = await request(server)
      .post(`${API}/users/pat`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'one-time', expiresInDays: 30 })
      .expect(201);
    expect(created.body.token).toBeTruthy();
    expect(created.body.pat.name).toBe('one-time');

    await request(server)
      .get(`${API}/sso/userinfo`)
      .set('Authorization', `Bearer ${created.body.token}`)
      .expect(200);

    // 列表不含 token 值
    const list = await request(server)
      .get(`${API}/users/pat`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    for (const pat of list.body.pats) {
      expect(pat).not.toHaveProperty('token');
    }
    const patId = list.body.pats.find(
      (p: any) => p.name === 'one-time',
    ).id as string;

    await request(server)
      .delete(`${API}/users/pat/${patId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(server)
      .get(`${API}/sso/userinfo`)
      .set('Authorization', `Bearer ${created.body.token}`)
      .expect(401);
  });
});

describe('SsoController 超管接入方管理 (e2e)', () => {
  let app: INestApplication<App>;
  const dbPath = process.env.DATABASE_PATH!;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    try {
      unlinkSync(dbPath);
    } catch {
      // 临时库清理失败不影响测试结果
    }
  });

  it('超管注册机密客户端：secret 仅创建时返回一次，列表不含 secret', async () => {
    const server = app.getHttpServer();
    const adminToken = (
      await request(server)
        .post(`${API}/admin/login`)
        .send({ username: 'admin', password: 'Qwer081213' })
        .expect(201)
    ).body.token as string;

    const created = await request(server)
      .post(`${API}/sso/clients`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        clientId: 'partner-e2e',
        name: 'e2e 合作伙伴',
        redirectUris: ['https://app.e2e.test/callback'],
        confidential: true,
      })
      .expect(201);
    expect(created.body.client_secret).toBeTruthy();

    // 重复注册幂等，不再泄露 secret
    const again = await request(server)
      .post(`${API}/sso/clients`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        clientId: 'partner-e2e',
        name: 'e2e 合作伙伴',
        redirectUris: ['https://app.e2e.test/callback'],
        confidential: true,
      })
      .expect(201);
    expect(again.body.client_secret).toBeNull();

    const list = await request(server)
      .get(`${API}/sso/clients`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body.clients.some((c: any) => c.clientId === 'partner-e2e')).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain(created.body.client_secret);

    // 机密客户端完整流程：secret 换 token 成功
    const userToken = await smsLogin(server, `135${String(Date.now()).slice(-8)}`);
    const { body } = await request(server)
      .post(`${API}/sso/authorize`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        client_id: 'partner-e2e',
        redirect_uri: 'https://app.e2e.test/callback',
      })
      .expect(201);
    await request(server)
      .post(`${API}/sso/token`)
      .send({
        grant_type: 'authorization_code',
        code: body.code,
        client_id: 'partner-e2e',
        client_secret: created.body.client_secret,
        redirect_uri: 'https://app.e2e.test/callback',
      })
      .expect(201);
  });

  it('无效凭证访问接入方管理返回 401', () => {
    return request(app.getHttpServer())
      .get(`${API}/sso/clients`)
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });
});
