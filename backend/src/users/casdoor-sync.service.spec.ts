import { CasdoorSyncService } from './casdoor-sync.service';
import { User } from './entities/user.entity';

describe('CasdoorSyncService（注册用户 → Casdoor 增量同步）', () => {
  let service: CasdoorSyncService;
  const OLD_ENV = process.env;
  const fetchMock = jest.fn();

  function makeUser(overrides: Partial<User> = {}): User {
    return {
      id: 'u-11111111-1111-1111-1111-111111111111',
      phone: '13900001111',
      email: null,
      displayName: '测试用户',
      orgId: 'org-22222222-2222-2222-2222-222222222222',
      ...overrides,
    } as User;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV };
    process.env.CASDOOR_ENDPOINT = 'http://casdoor.test:28000/';
    process.env.CASDOOR_ORG = 'csi';
    process.env.CASDOOR_CLIENT_ID = 'cid';
    process.env.CASDOOR_CLIENT_SECRET = 'csecret';
    (global as any).fetch = fetchMock;
    service = new CasdoorSyncService();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('未配置凭证时直接跳过，不发起请求', async () => {
    delete process.env.CASDOOR_CLIENT_SECRET;
    await service.syncUser(makeUser());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('同步成功：POST add-user，name=手机号，org_id/genesis_user_id 落 property', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ status: 'ok' }),
    });
    await service.syncUser(makeUser());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://casdoor.test:28000/api/add-user'); // 尾斜杠已去
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.owner).toBe('csi');
    expect(body.name).toBe('13900001111');
    expect(body.phone).toBe(''); // Casdoor phone 校验绕不过，置空
    expect(body.email).toBe('u-11111111-1@noop.csi.shopping'); // 无 email 用占位（id 前 12 位）
    expect(body.properties.org_id).toBe('org-22222222-2222-2222-2222-222222222222');
    expect(body.properties.genesis_user_id).toBe(makeUser().id);
    expect(body.properties.genesis_phone).toBe('13900001111');
    expect(init.headers.Authorization).toMatch(/^Basic /);
  });

  it('Casdoor 返回 already exist → 幂等跳过，不报错', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ status: 'error', msg: 'the user already exists' }),
    });
    await expect(service.syncUser(makeUser())).resolves.toBeUndefined();
  });

  it('其他业务失败 → 记日志不抛出（不阻断注册主流程）', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ status: 'error', msg: 'Phone number is invalid' }),
    });
    await expect(service.syncUser(makeUser())).resolves.toBeUndefined();
  });

  it('网络异常 → 不抛出', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(service.syncUser(makeUser())).resolves.toBeUndefined();
  });
});
