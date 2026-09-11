import { Test, TestingModule } from '@nestjs/testing';
import { WechatTemplateService } from './wechat-template.service';
import { WechatTokenService } from './wechat-token.service';

describe('WechatTemplateService（微信公众号模板消息发送）', () => {
  let service: WechatTemplateService;
  const mockTokenService = { getAccessToken: jest.fn() };

  const OLD_ENV = process.env;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV };
    delete process.env.WECHAT_MOCK_MODE;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WechatTemplateService,
        { provide: WechatTokenService, useValue: mockTokenService },
      ],
    }).compile();
    service = module.get(WechatTemplateService);
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('模板 ID 或 openid 缺失 → skip（done=true, delivered=false）', async () => {
    const r = await service.send('', 'tmpl-1', {});
    expect(r).toEqual({ done: true, delivered: false, retryable: false });
    expect(mockTokenService.getAccessToken).not.toHaveBeenCalled();
  });

  it('mock 模式 → 不调微信真实 API，模拟送达', async () => {
    process.env.WECHAT_MOCK_MODE = 'true';
    const r = await service.send('openid-1', 'tmpl-1', { amountCny: '100' });
    expect(r).toEqual({ done: true, delivered: true, retryable: false });
    expect(mockTokenService.getAccessToken).not.toHaveBeenCalled();
  });

  it('非 mock 且 token 获取失败 → 可重试', async () => {
    mockTokenService.getAccessToken.mockRejectedValue(new Error('boom'));
    const r = await service.send('openid-1', 'tmpl-1', {});
    expect(r.done).toBe(false);
    expect(r.retryable).toBe(true);
    expect(r.error).toContain('token:boom');
  });
});