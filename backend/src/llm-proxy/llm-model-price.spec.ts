import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LlmModelPrice } from './llm-model-price.entity';
import { LlmModelPriceService, DEFAULT_MODEL_PRICES } from './llm-model-price.service';

describe('LlmModelPriceService（计费单价外置 DB：缓存 + 回退）', () => {
  let service: LlmModelPriceService;
  const repo = {
    find: jest.fn(),
    save: jest.fn(async (arg: unknown) => arg),
    delete: jest.fn(async () => ({ affected: 1 })),
    count: jest.fn(async () => 0),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmModelPriceService,
        { provide: getRepositoryToken(LlmModelPrice), useValue: repo },
      ],
    }).compile();
    service = module.get(LlmModelPriceService);
  });

  it('表空时启动加载内建默认价兜底（行为不变）', async () => {
    repo.find.mockResolvedValue([]);
    await service.onModuleInit();
    expect(service.getPrice('gpt-5.4')).toEqual({ input: 200, output: 800 });
    expect(service.getPriceOrFallback('gpt-5.5')).toEqual({ input: 400, output: 1600 });
  });

  it('DB 命中模型按 DB 单价返回', async () => {
    repo.find.mockResolvedValue([
      { modelName: 'claude-fable-5', inputPrice: 300, outputPrice: 1200 },
    ]);
    await service.onModuleInit();
    expect(service.getPrice('claude-fable-5')).toEqual({ input: 300, output: 1200 });
  });

  it('未登记模型回退 gpt-5.4 价', async () => {
    repo.find.mockResolvedValue([]);
    await service.onModuleInit();
    expect(service.getPriceOrFallback('gpt-4o')).toEqual({ input: 200, output: 800 });
  });

  it('写操作后缓存失效重载', async () => {
    repo.find.mockResolvedValue([]);
    await service.onModuleInit();
    repo.find.mockResolvedValue([
      { modelName: 'new-model', inputPrice: 100, outputPrice: 200 },
    ]);
    await service.upsert('new-model', 100, 200);
    expect(service.getPrice('new-model')).toEqual({ input: 100, output: 200 });
  });

  it('seedFromInternal 用内建默认价登记，返回计数', async () => {
    await service.seedFromInternal();
    expect(repo.save).toHaveBeenCalledTimes(Object.keys(DEFAULT_MODEL_PRICES).length);
  });
});