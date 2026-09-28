import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LlmChannel } from './llm-channel.entity';
import {
  LlmChannelService,
  DEFAULT_CHANNELS,
  hostOfBaseUrl,
} from './llm-channel.service';

describe('LlmChannelService（渠道别名表：缓存 + 按 baseUrl 自动读取）', () => {
  let service: LlmChannelService;
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn((arg: unknown) => Promise.resolve(arg)),
    delete: jest.fn(() => Promise.resolve({ affected: 1 })),
    count: jest.fn(() => Promise.resolve(0)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmChannelService,
        { provide: getRepositoryToken(LlmChannel), useValue: repo },
      ],
    }).compile();
    service = module.get(LlmChannelService);
  });

  it('hostOfBaseUrl 提取主机名（小写），非法 URL 返回 null', () => {
    expect(hostOfBaseUrl('https://open.cherryin.ai/v1')).toBe(
      'open.cherryin.ai',
    );
    expect(hostOfBaseUrl('HTTP://API.LK888.AI:8080/v1')).toBe('api.lk888.ai');
    expect(hostOfBaseUrl('not-a-url')).toBeNull();
  });

  it('按主机名精确匹配返回对应渠道别名表', async () => {
    repo.find.mockResolvedValue([
      {
        host: 'opencode.ai',
        label: 'zen',
        aliases: { 'gpt-5.5': 'deepseek-v4.1-flash' },
      },
      { host: 'open.cherryin.ai', label: 'cherryin', aliases: {} },
    ]);
    await service.onModuleInit();
    expect(service.resolveAliases('https://opencode.ai/zen/go/v1')).toEqual({
      'gpt-5.5': 'deepseek-v4.1-flash',
    });
    // cherryin 别名表为空 = 原样透传
    expect(service.resolveAliases('https://open.cherryin.ai/v1')).toEqual({});
  });

  it('子域按注册域名后缀匹配', async () => {
    repo.find.mockResolvedValue([
      {
        host: 'opencode.ai',
        label: 'zen',
        aliases: { 'gpt-5.4': 'deepseek-v4.1-flash' },
      },
    ]);
    await service.onModuleInit();
    expect(service.resolveChannel('https://api.opencode.ai/v1')?.host).toBe(
      'opencode.ai',
    );
  });

  it('未登记渠道/非法 baseUrl → null（空别名表，原样透传）', async () => {
    repo.find.mockResolvedValue([]);
    await service.onModuleInit();
    expect(service.resolveChannel('https://unknown.gateway/v1')).toBeNull();
    expect(service.resolveChannel('not-a-url')).toBeNull();
    expect(service.resolveAliases('https://unknown.gateway/v1')).toEqual({});
  });

  it('缓存加载失败 → 退化为空表（透传）而非抛错', async () => {
    repo.find.mockRejectedValue(new Error('db down'));
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.resolveAliases('https://opencode.ai/v1')).toEqual({});
  });

  it('upsert 归一化主机名并清洗别名表，写后缓存重载生效', async () => {
    repo.find.mockResolvedValue([]);
    await service.onModuleInit();
    repo.findOne.mockResolvedValue(null);
    repo.find.mockResolvedValue([
      {
        host: 'open.cherryin.ai',
        label: 'cherryin',
        aliases: { 'gpt-5.5': 'openai/gpt-5.5' },
      },
    ]);
    const saved = await service.upsert('Open.Cherryin.AI', {
      label: 'cherryin',
      aliases: { 'gpt-5.5': 'openai/gpt-5.5', '': '' },
    });
    expect(saved.host).toBe('open.cherryin.ai');
    expect(saved.aliases).toEqual({ 'gpt-5.5': 'openai/gpt-5.5' });
    expect(service.resolveAliases('https://open.cherryin.ai/v1')).toEqual({
      'gpt-5.5': 'openai/gpt-5.5',
    });
  });

  it('seedDefaults 写入内建渠道种子（zen 别名表 + 已知渠道）', async () => {
    await service.seedDefaults();
    expect(repo.save).toHaveBeenCalledTimes(DEFAULT_CHANNELS.length);
    const hosts = (repo.save.mock.calls as unknown[][]).map(
      (c) => (c[0] as { host: string }).host,
    );
    expect(hosts).toEqual(['opencode.ai', 'open.cherryin.ai', 'api.lk888.ai']);
    const firstSave = (repo.save.mock.calls as unknown[][])[0][0] as {
      host: string;
      aliases: Record<string, string>;
    };
    expect(firstSave.host).toBe('opencode.ai');
    expect(firstSave.aliases).toEqual(
      expect.objectContaining({ 'gpt-5.5': 'deepseek-v4.1-flash' }),
    );
  });

  it('remove 归一化主机名后删除并重载', async () => {
    await service.remove('OpenCode.AI');
    expect(repo.delete).toHaveBeenCalledWith({ host: 'opencode.ai' });
  });
});
