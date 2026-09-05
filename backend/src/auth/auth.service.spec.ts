import { AuthService } from './auth.service';
import { AccessToken } from './entities/access-token.entity';
import { User } from '../users/entities/user.entity';

const makeUser = (): User => ({ id: 'user-uuid' }) as User;

const makeTokenRow = (overrides: Partial<AccessToken> = {}): AccessToken =>
  ({
    id: 'row-uuid',
    user: makeUser(),
    tokenHash: 'hash',
    name: null,
    clientId: null,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date(),
    ...overrides,
  }) as AccessToken;

describe('AuthService 令牌撤销与 PAT', () => {
  let service: AuthService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };

  beforeEach(() => {
    repository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
    };
    service = new AuthService(repository as any);
  });

  describe('issuePersonalAccessToken', () => {
    it('创建 PAT：标记 name 与 pat 来源', async () => {
      const { token, expiresAt } = await service.issuePersonalAccessToken(
        makeUser(),
        'genesis-agent',
      );

      expect(token).toBeTruthy();
      expect(expiresAt).toBeNull();
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'genesis-agent',
          clientId: 'pat',
          expiresAt: null,
          revokedAt: null,
        }),
      );
    });

    it('指定有效期时计算 expiresAt', async () => {
      const before = Date.now();
      await service.issuePersonalAccessToken(makeUser(), 'ci', 90);
      const created = repository.create.mock.calls[0][0];
      const expectedMin = before + 90 * 24 * 60 * 60 * 1000;
      expect(created.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
    });
  });

  describe('listPersonalAccessTokens', () => {
    it('仅查询当前用户的 PAT 并按创建时间倒序', async () => {
      await service.listPersonalAccessTokens('user-uuid');
      expect(repository.find).toHaveBeenCalledWith({
        where: { user: { id: 'user-uuid' }, clientId: 'pat' },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('revokePersonalAccessToken', () => {
    it('撤销本人 PAT', async () => {
      const row = makeTokenRow({ clientId: 'pat' });
      repository.findOne.mockResolvedValue(row);

      await expect(
        service.revokePersonalAccessToken('user-uuid', 'row-uuid'),
      ).resolves.toBe(true);
      expect(row.revokedAt).toBeInstanceOf(Date);
      expect(repository.save).toHaveBeenCalledWith(row);
    });

    it('令牌不存在时返回 false', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(
        service.revokePersonalAccessToken('user-uuid', 'missing'),
      ).resolves.toBe(false);
    });

    it('已撤销的令牌返回 false', async () => {
      repository.findOne.mockResolvedValue(
        makeTokenRow({ clientId: 'pat', revokedAt: new Date() }),
      );
      await expect(
        service.revokePersonalAccessToken('user-uuid', 'row-uuid'),
      ).resolves.toBe(false);
    });
  });

  describe('revokeAllUserTokens（SSO 单点登出）', () => {
    it('全局登出：撤销登录与 SSO 令牌，不动 PAT', async () => {
      const loginToken = makeTokenRow({ id: 'login' });
      const ssoToken = makeTokenRow({ id: 'sso', clientId: 'openclaw-cli' });
      const pat = makeTokenRow({ id: 'pat', clientId: 'pat' });
      const alreadyRevoked = makeTokenRow({ id: 'dead', revokedAt: new Date() });
      repository.find.mockResolvedValue([
        loginToken,
        ssoToken,
        pat,
        alreadyRevoked,
      ]);

      const revoked = await service.revokeAllUserTokens('user-uuid');

      expect(revoked).toBe(2);
      expect(loginToken.revokedAt).toBeInstanceOf(Date);
      expect(ssoToken.revokedAt).toBeInstanceOf(Date);
      expect(pat.revokedAt).toBeNull();
      expect(repository.save).toHaveBeenCalledWith([loginToken, ssoToken]);
    });

    it('定向登出：仅撤销指定 client_id 的令牌', async () => {
      const ssoToken = makeTokenRow({ id: 'sso', clientId: 'openclaw-cli' });
      const loginToken = makeTokenRow({ id: 'login' });
      repository.find.mockResolvedValue([ssoToken, loginToken]);

      const revoked = await service.revokeAllUserTokens(
        'user-uuid',
        'openclaw-cli',
      );

      expect(revoked).toBe(1);
      expect(ssoToken.revokedAt).toBeInstanceOf(Date);
      expect(loginToken.revokedAt).toBeNull();
    });

    it('没有可撤销令牌时不调用 save', async () => {
      repository.find.mockResolvedValue([]);
      const revoked = await service.revokeAllUserTokens('user-uuid');
      expect(revoked).toBe(0);
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('revokeToken（单设备登出）', () => {
    it('按明文 token 哈希查找并撤销', async () => {
      const { createHash } = require('crypto');
      const token = 'plain-token';
      const row = makeTokenRow({ tokenHash: createHash('sha256').update(token).digest('hex') });
      repository.findOne.mockResolvedValue(row);

      await service.revokeToken(token);

      expect(row.revokedAt).toBeInstanceOf(Date);
      expect(repository.save).toHaveBeenCalledWith(row);
    });
  });
});
