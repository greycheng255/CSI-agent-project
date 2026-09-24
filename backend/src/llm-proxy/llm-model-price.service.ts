import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LlmModelPrice } from './llm-model-price.entity';

/**
 * 内建默认单价（人民币分 / 百万 tokens）。DB 表为空时用此种子，保持原计费行为不变。
 * 与旧 llm-proxy.service 的 MODEL_UNIT_PRICES 等价；建表后由管理员在线改价覆盖。
 */
export const DEFAULT_MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'gpt-5.4': { input: 200, output: 800 }, // ¥2/M 输入 · ¥8/M 输出
  'gpt-5.5': { input: 400, output: 1600 }, // ¥4/M 输入 · ¥16/M 输出（旗舰）
};
export const FALLBACK_PRICE = DEFAULT_MODEL_PRICES['gpt-5.4'];

/**
 * LLM 计费单价查询服务：价格表落地 DB，启动时缓存全表，写操作后失效重载。
 * 单实例 + 写时驱逐即可，无需 TTL。
 */
@Injectable()
export class LlmModelPriceService implements OnModuleInit {
  private readonly logger = new Logger(LlmModelPriceService.name);
  private cache = new Map<string, { input: number; output: number }>();

  constructor(
    @InjectRepository(LlmModelPrice)
    private readonly repo: Repository<LlmModelPrice>,
  ) {}

  async onModuleInit() {
    await this.reload();
  }

  private async reload(): Promise<void> {
    try {
      const rows = await this.repo.find();
      this.cache = new Map(
        rows.map((r) => [r.modelName, { input: r.inputPrice, output: r.outputPrice }]),
      );
      // 表空时用内建默认价兜底，避免计量把未知/未登记模型全部按 gpt-5.4 之外额外交费行为突变
      for (const [model, price] of Object.entries(DEFAULT_MODEL_PRICES)) {
        if (!this.cache.has(model)) this.cache.set(model, price);
      }
      this.logger.log(`llm price cache loaded: ${this.cache.size} models`);
    } catch (err) {
      this.logger.warn(`llm price cache load failed (will seed defaults): ${String(err)}`);
      this.cache = new Map(Object.entries(DEFAULT_MODEL_PRICES));
    }
  }

  /** 查询单价；可从缓存即时返回（getPrice 同步接口，供计费热路径使用） */
  getPrice(model: string): { input: number; output: number } | undefined {
    return this.cache.get(model);
  }

  /** 按模型查询，未命中回退 FALLBACK（与旧行为一致） */
  getPriceOrFallback(model: string): { input: number; output: number } {
    return this.cache.get(model) ?? FALLBACK_PRICE;
  }

  async list(): Promise<LlmModelPrice[]> {
    return this.repo.find({ order: { modelName: 'ASC' } });
  }

  async upsert(modelName: string, input: number, output: number): Promise<LlmModelPrice> {
    const saved = await this.repo.save({ modelName, inputPrice: input, outputPrice: output });
    await this.reload();
    return saved;
  }

  async remove(modelName: string): Promise<void> {
    await this.repo.delete({ modelName });
    await this.reload();
  }

  /** 用内建默认价 upsert（重建种子），返回登记条数 */
  async seedFromInternal(): Promise<number> {
    for (const [model, price] of Object.entries(DEFAULT_MODEL_PRICES)) {
      await this.repo.save({ modelName: model, inputPrice: price.input, outputPrice: price.output });
    }
    await this.reload();
    return this.repo.count();
  }
}