import { createHmac, randomBytes } from 'crypto';
import { OidcService } from './oidc.service';
import { OrgService } from '../orgs/org.service';

const base64url = (value: string) =>
  Buffer.from(value, 'utf8').toString('base64url');

describe('OidcService', () => {
  let service: OidcService;
  let orgService: { resolveByUserId: jest.Mock };

  beforeAll(() => {
    process.env.SSO_OIDC_ISSUER = 'https://idp.example.test';
    process.env.SSO_OIDC_SIGNING_SECRET = 'test-signing-secret';
  });

  afterAll(() => {
    delete process.env.SSO_OIDC_ISSUER;
    delete process.env.SSO_OIDC_SIGNING_SECRET;
  });

  beforeEach(() => {
    orgService = { resolveByUserId: jest.fn() };
    service = new OidcService(orgService as any);
  });

  describe('parseScopes', () => {
    it('空格分隔、去重、小写', () => {
      expect(service.parseScopes('openid Profile OPENID')).toEqual([
        'openid',
        'profile',
      ]);
    });
    it('空值返回空数组', () => {
      expect(service.parseScopes(undefined)).toEqual([]);
      expect(service.parseScopes('')).toEqual([]);
    });
  });

  describe('issueIdToken', () => {
    it('签发含标准 claim + org_id + nonce 的 HS256 id_token', async () => {
      orgService.resolveByUserId.mockResolvedValue({
        id: 'org-1',
        slug: 'org-abc',
      });

      const token = await service.issueIdToken(
        {
          id: 'user-1',
          phone: '13800000000',
          email: 'a@b.test',
          displayName: '示例',
        },
        'console-client',
        'nonce-xyz',
        ['openid', 'profile', 'email'],
      );

      const parts = token.split('.');
      expect(parts).toHaveLength(3);

      const header = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf8'),
      );
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8'),
      );
      expect(header.alg).toBe('HS256');
      expect(header.typ).toBe('JWT');
      expect(payload.iss).toBe('https://idp.example.test');
      expect(payload.sub).toBe('user-1');
      expect(payload.aud).toBe('console-client');
      expect(payload.nonce).toBe('nonce-xyz');
      expect(payload.name).toBe('示例');
      expect(payload.email).toBe('a@b.test');
      expect(payload.org_id).toBe('org-1');
      expect(payload.org_slug).toBe('org-abc');
      expect(payload.exp).toBeGreaterThan(payload.iat);
    });

    it('未携带 nonce 时不写入 nonce claim', async () => {
      orgService.resolveByUserId.mockResolvedValue({ id: 'org-1' });
      const token = await service.issueIdToken(
        { id: 'user-1' },
        'c',
        null,
        ['openid'],
      );
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
      );
      expect(payload).not.toHaveProperty('nonce');
    });

    it('未解析到 org 时省略 org_id claim', async () => {
      orgService.resolveByUserId.mockResolvedValue(null);
      const token = await service.issueIdToken(
        { id: 'user-1' },
        'c',
        null,
        ['openid'],
      );
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
      );
      expect(payload).not.toHaveProperty('org_id');
    });
  });

  describe('verifyJwt', () => {
    it('同密钥验签通过并返回 payload', async () => {
      orgService.resolveByUserId.mockResolvedValue({ id: 'org-1' });
      const token = await service.issueIdToken(
        { id: 'user-1' },
        'c',
        'n',
        ['openid'],
      );
      const payload = service.verifyJwt(token);
      expect(payload).toBeTruthy();
      expect(payload?.sub).toBe('user-1');
      expect(payload?.org_id).toBe('org-1');
    });

    it('篡改签名验签失败返回 null', async () => {
      orgService.resolveByUserId.mockResolvedValue({ id: 'org-1' });
      const token = await service.issueIdToken(
        { id: 'user-1' },
        'c',
        null,
        ['openid'],
      );
      const [header, payload] = token.split('.');
      const tampered = `${header}.${payload}.invalid-signature`;
      expect(service.verifyJwt(tampered)).toBeNull();
    });

    it('不同密钥签发的 token 验签失败', async () => {
      const signingInput = `${base64url(
        JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      )}.${base64url(JSON.stringify({ sub: 'x' }))}`;
      const sig = createHmac('sha256', randomBytes(32))
        .update(signingInput)
        .digest('base64url');
      expect(service.verifyJwt(`${signingInput}.${sig}`)).toBeNull();
    });
  });

  describe('getDiscovery', () => {
    it('暴露标准 OIDC discovery 字段与 HS256', () => {
      const discovery = service.getDiscovery();
      expect(discovery.issuer).toBe('https://idp.example.test');
      expect(discovery.authorization_endpoint).toBe(
        'https://idp.example.test/api/v1/sso/authorize',
      );
      expect(discovery.token_endpoint).toBe(
        'https://idp.example.test/api/v1/sso/token',
      );
      expect(discovery.userinfo_endpoint).toBe(
        'https://idp.example.test/api/v1/sso/userinfo',
      );
      expect(discovery.id_token_signing_alg_values_supported).toEqual([
        'HS256',
      ]);
      expect(discovery.scopes_supported).toContain('openid');
      expect(discovery.code_challenge_methods_supported).toEqual(['S256']);
      expect(discovery.claims_supported).toContain('org_id');
      // HS256 对称签名不暴露 jwks_uri
      expect(discovery).not.toHaveProperty('jwks_uri');
    });
  });
});
