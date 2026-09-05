import { BadRequestException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { SsoService } from './sso.service';
import { SsoClient } from './entities/sso-client.entity';
import { User } from '../users/entities/user.entity';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const makeClient = (overrides: Partial<SsoClient> = {}): SsoClient =>
  ({
    id: 'client-uuid',
    clientId: 'test-client',
    name: 'Test Client',
    clientSecretHash: null,
    redirectUris: JSON.stringify(['https://app.example.com/callback']),
    createdAt: new Date(),
    getRedirectUris() {
      return JSON.parse(this.redirectUris);
    },
    ...overrides,
  }) as SsoClient;

const LOOPBACK_CLIENT = makeClient({
  clientId: 'cli-client',
  redirectUris: JSON.stringify([
    'http://127.0.0.1/callback',
    'http://localhost/callback',
  ]),
});

const makeUser = (): User =>
  ({
    id: 'user-uuid',
    phone: '13800000000',
    displayName: '测试用户',
    email: null,
    kycStatus: 'NONE',
  }) as User;

describe('SsoService', () => {
  let service: SsoService;
  let clientsRepository: { findOne: jest.Mock; find: jest.Mock; create: jest.Mock; save: jest.Mock };
  let authCodesRepository: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock; delete: jest.Mock };
  let authService: { issueUserToken: jest.Mock };

  const codeRow = (overrides: Record<string, unknown> = {}) => ({
    codeHash: sha256('raw-code'),
    user: makeUser(),
    clientId: 'test-client',
    redirectUri: 'https://app.example.com/callback',
    codeChallenge: null,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    usedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    clientsRepository = {
      findOne: jest.fn(),
      find: jest.fn(async () => []),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    authCodesRepository = {
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      delete: jest.fn(async () => ({ affected: 0 })),
    };
    authService = { issueUserToken: jest.fn(async () => 'issued-token') };
    service = new SsoService(
      clientsRepository as any,
      authCodesRepository as any,
      authService as any,
    );
  });

  describe('isRedirectUriAllowed', () => {
    it('允许白名单精确匹配', () => {
      expect(
        service.isRedirectUriAllowed(
          makeClient(),
          'https://app.example.com/callback',
        ),
      ).toBe(true);
    });

    it('拒绝白名单之外的非回环地址', () => {
      expect(
        service.isRedirectUriAllowed(
          makeClient(),
          'https://evil.example.com/callback',
        ),
      ).toBe(false);
    });

    it('回环地址允许任意端口（RFC 8252）', () => {
      expect(
        service.isRedirectUriAllowed(
          LOOPBACK_CLIENT,
          'http://127.0.0.1:53741/callback',
        ),
      ).toBe(true);
      expect(
        service.isRedirectUriAllowed(
          LOOPBACK_CLIENT,
          'http://localhost:40000/callback',
        ),
      ).toBe(true);
    });

    it('回环地址路径不匹配时拒绝', () => {
      expect(
        service.isRedirectUriAllowed(
          LOOPBACK_CLIENT,
          'http://127.0.0.1:53741/other',
        ),
      ).toBe(false);
    });

    it('回环地址协议不匹配时拒绝', () => {
      expect(
        service.isRedirectUriAllowed(
          LOOPBACK_CLIENT,
          'https://127.0.0.1:53741/callback',
        ),
      ).toBe(false);
    });

    it('非法 URL 拒绝', () => {
      expect(service.isRedirectUriAllowed(makeClient(), 'not-a-url')).toBe(
        false,
      );
    });
  });

  describe('validateAuthorizeRequest', () => {
    it('缺少 client_id 时拒绝', async () => {
      await expect(
        service.validateAuthorizeRequest({
          clientId: '',
          redirectUri: 'https://app.example.com/callback',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('仅支持 S256 code_challenge_method', async () => {
      await expect(
        service.validateAuthorizeRequest({
          clientId: 'test-client',
          redirectUri: 'https://app.example.com/callback',
          codeChallengeMethod: 'plain',
        }),
      ).rejects.toThrow('仅支持 S256');
    });

    it('未注册的 client_id 拒绝', async () => {
      clientsRepository.findOne.mockResolvedValue(null);
      await expect(
        service.validateAuthorizeRequest({
          clientId: 'unknown',
          redirectUri: 'https://app.example.com/callback',
        }),
      ).rejects.toThrow('未注册的 client_id');
    });

    it('redirect_uri 不在白名单时拒绝', async () => {
      clientsRepository.findOne.mockResolvedValue(makeClient());
      await expect(
        service.validateAuthorizeRequest({
          clientId: 'test-client',
          redirectUri: 'https://evil.example.com/callback',
        }),
      ).rejects.toThrow('redirect_uri 未在白名单中');
    });

    it('合法请求返回客户端', async () => {
      const client = makeClient();
      clientsRepository.findOne.mockResolvedValue(client);
      await expect(
        service.validateAuthorizeRequest({
          clientId: 'test-client',
          redirectUri: 'https://app.example.com/callback',
        }),
      ).resolves.toBe(client);
    });
  });

  describe('issueAuthorizationCode', () => {
    it('签发一次性授权码并入库', async () => {
      clientsRepository.findOne.mockResolvedValue(makeClient());

      const result = await service.issueAuthorizationCode(makeUser(), {
        clientId: 'test-client',
        redirectUri: 'https://app.example.com/callback',
        codeChallenge: 'challenge-value',
      });

      expect(result.code).toBeTruthy();
      expect(result.clientId).toBe('test-client');
      expect(authCodesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // 入库的是哈希而非明文
          codeHash: sha256(result.code),
          codeChallenge: 'challenge-value',
          usedAt: null,
        }),
      );
      const created = authCodesRepository.create.mock.calls[0][0];
      // 有效期约 10 分钟（允许秒级误差）
      const ttlMs = created.expiresAt.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(9 * 60 * 1000);
      expect(ttlMs).toBeLessThanOrEqual(10 * 60 * 1000);
    });
  });

  describe('exchangeCode', () => {
    const baseRequest = {
      grantType: 'authorization_code',
      code: 'raw-code',
      clientId: 'test-client',
      redirectUri: 'https://app.example.com/callback',
    };

    it('拒绝非 authorization_code 授权类型', async () => {
      await expect(
        service.exchangeCode({ ...baseRequest, grantType: 'password' }),
      ).rejects.toThrow('仅支持 authorization_code');
    });

    it('拒绝未注册的 client_id', async () => {
      clientsRepository.findOne.mockResolvedValue(null);
      await expect(service.exchangeCode(baseRequest)).rejects.toThrow(
        '未注册的 client_id',
      );
    });

    it('拒绝无效授权码', async () => {
      clientsRepository.findOne.mockResolvedValue(makeClient());
      authCodesRepository.findOne.mockResolvedValue(null);
      await expect(service.exchangeCode(baseRequest)).rejects.toThrow(
        '无效的授权码',
      );
    });

    it('拒绝重放的授权码', async () => {
      clientsRepository.findOne.mockResolvedValue(makeClient());
      authCodesRepository.findOne.mockResolvedValue(codeRow({ usedAt: new Date() }));
      await expect(service.exchangeCode(baseRequest)).rejects.toThrow(
        '授权码已被使用',
      );
    });

    it('拒绝过期的授权码', async () => {
      clientsRepository.findOne.mockResolvedValue(makeClient());
      authCodesRepository.findOne.mockResolvedValue(
        codeRow({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.exchangeCode(baseRequest)).rejects.toThrow(
        '授权码已过期',
      );
    });

    it('拒绝与签发时不一致的 redirect_uri', async () => {
      clientsRepository.findOne.mockResolvedValue(makeClient());
      authCodesRepository.findOne.mockResolvedValue(codeRow());
      await expect(
        service.exchangeCode({
          ...baseRequest,
          redirectUri: 'https://app.example.com/other',
        }),
      ).rejects.toThrow('redirect_uri 与授权时不一致');
    });

    it('公开客户端缺少 code_verifier 时拒绝', async () => {
      clientsRepository.findOne.mockResolvedValue(makeClient());
      authCodesRepository.findOne.mockResolvedValue(
        codeRow({ codeChallenge: 'challenge-value' }),
      );
      await expect(service.exchangeCode(baseRequest)).rejects.toThrow(
        '缺少 code_verifier',
      );
    });

    it('PKCE 校验失败时拒绝', async () => {
      clientsRepository.findOne.mockResolvedValue(makeClient());
      authCodesRepository.findOne.mockResolvedValue(
        codeRow({ codeChallenge: 'challenge-value' }),
      );
      await expect(
        service.exchangeCode({ ...baseRequest, codeVerifier: 'wrong-verifier' }),
      ).rejects.toThrow('PKCE 校验失败');
    });

    it('公开客户端授权时未携带 code_challenge 时拒绝', async () => {
      clientsRepository.findOne.mockResolvedValue(makeClient());
      authCodesRepository.findOne.mockResolvedValue(codeRow());
      await expect(service.exchangeCode(baseRequest)).rejects.toThrow(
        '公开客户端必须使用 PKCE',
      );
    });

    it('PKCE 校验通过后签发 token 并作废授权码', async () => {
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256')
        .update(verifier)
        .digest('base64url');
      const row = codeRow({ codeChallenge: challenge });

      clientsRepository.findOne.mockResolvedValue(makeClient());
      authCodesRepository.findOne.mockResolvedValue(row);

      const result = await service.exchangeCode({
        ...baseRequest,
        codeVerifier: verifier,
      });

      expect(row.usedAt).toBeInstanceOf(Date);
      expect(authCodesRepository.save).toHaveBeenCalledWith(row);
      expect(authService.issueUserToken).toHaveBeenCalledWith(
        row.user,
        { clientId: 'test-client' },
      );
      expect(result.access_token).toBe('issued-token');
      expect(result.token_type).toBe('Bearer');
      expect(result.user.id).toBe('user-uuid');
    });

    it('机密客户端 secret 错误时拒绝', async () => {
      clientsRepository.findOne.mockResolvedValue(
        makeClient({ clientSecretHash: sha256('correct-secret') }),
      );
      authCodesRepository.findOne.mockResolvedValue(codeRow());
      await expect(
        service.exchangeCode({ ...baseRequest, clientSecret: 'wrong-secret' }),
      ).rejects.toThrow('client_secret 校验失败');
    });

    it('机密客户端 secret 正确且无 PKCE 时成功', async () => {
      clientsRepository.findOne.mockResolvedValue(
        makeClient({ clientSecretHash: sha256('correct-secret') }),
      );
      const row = codeRow();
      authCodesRepository.findOne.mockResolvedValue(row);

      const result = await service.exchangeCode({
        ...baseRequest,
        clientSecret: 'correct-secret',
      });

      expect(result.access_token).toBe('issued-token');
      expect(row.usedAt).toBeInstanceOf(Date);
    });
  });

  describe('ensureClient', () => {
    it('新建机密客户端时返回一次性明文 secret', async () => {
      clientsRepository.findOne.mockResolvedValue(null);

      const { client, secret } = await service.ensureClient(
        'new-client',
        '新应用',
        ['https://new.example.com/callback'],
        true,
      );

      expect(secret).toBeTruthy();
      expect(client.clientSecretHash).toBe(sha256(secret!));
      expect(clientsRepository.save).toHaveBeenCalled();
    });

    it('新建公开客户端不生成 secret', async () => {
      clientsRepository.findOne.mockResolvedValue(null);

      const { client, secret } = await service.ensureClient(
        'public-client',
        '公开应用',
        [],
        false,
      );

      expect(secret).toBeUndefined();
      expect(client.clientSecretHash).toBeNull();
    });

    it('客户端已存在时幂等返回且不泄露 secret', async () => {
      const existing = makeClient({
        clientSecretHash: sha256('stored-secret'),
      });
      clientsRepository.findOne.mockResolvedValue(existing);

      const { client, secret } = await service.ensureClient(
        'test-client',
        'Test Client',
        [],
        true,
      );

      expect(client).toBe(existing);
      expect(secret).toBeUndefined();
      expect(clientsRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllUserTokens 依赖的列表接口', () => {
    it('listClients 按创建时间倒序返回', async () => {
      clientsRepository.find.mockResolvedValue([makeClient()]);
      await service.listClients();
      expect(clientsRepository.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
      });
    });
  });
});
