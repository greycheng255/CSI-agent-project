import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LlmChannel } from './llm-channel.entity';

/**
 * 内建渠道种子：迁移前硬编码的 zen 别名表 + 联调期已知渠道。
 * 表空时由管理员调用 POST /seed-defaults 写入；启动不自动写库（与价格表同思路）。
 */
export const DEFAULT_CHANNELS: {
  host: string;
  label: string;
  aliases: Record<string, string>;
  note: string;
}[] = [
  {
    host: 'opencode.ai',
    label: 'OpenCode Zen',
    aliases: {
      'gpt-5.4': 'deepseek-v4.1-flash',
      'gpt-5.5': 'deepseek-v4.1-flash',
      'openai/gpt-5.4': 'deepseek-v4.1-flash',
      'openai/gpt-5.5': 'deepseek-v4.1-flash',
    },
    note: 'zen 上游目录无 gpt-5.x，统一改写为 deepseek-v4.1-flash',
  },
  {
    host: 'open.cherryin.ai',
    label: 'Cherry Studio (cherryin)',
    aliases: {
      'gpt-5.4': 'openai/gpt-5.4',
      'gpt-5.5': 'openai/gpt-5.5',
    },
    note: '上游要求 vendor 前缀，裸名补 openai/ 前缀；已带前缀的名字原样透传',
  },
  {
    host: 'api.lk888.ai',
    label: 'ONELLM',
    aliases: {},
    note: '自建网关，模型名原样透传',
  },
];

/** 从 baseUrl 提取主机名（非法 URL 返回 null） */
export function hostOfBaseUrl(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 渠道别名表服务：别名映射落地 DB，启动时缓存全表，写操作后失效重载。
 * 转发热路径按 baseUrl 主机名即时查询（同步），未登记渠道=空表=原样透传。
 */
@Injectable()
export class LlmChannelService implements OnModuleInit {
  private readonly logger = new Logger(LlmChannelService.name);
  private cache = new Map<string, LlmChannel>();

  constructor(
    @InjectRepository(LlmChannel)
    private readonly repo: Repository<LlmChannel>,
  ) {}

  async onModuleInit() {
    await this.reload();
  }

  private async reload(): Promise<void> {
    try {
      const rows = await this.repo.find();
      this.cache = new Map(rows.map((r) => [r.host.toLowerCase(), r]));
      this.logger.log(`llm channel cache loaded: ${this.cache.size} channels`);
    } catch (err) {
      this.logger.warn(
        `llm channel cache load failed (passthrough until seeded): ${String(err)}`,
      );
      this.cache = new Map();
    }
  }

  /**
   * 按 baseUrl 找到对应渠道：先精确匹配主机名，再按注册域名做后缀匹配（覆盖子域）。
   * 未登记返回 null。
   */
  resolveChannel(baseUrl: string): LlmChannel | null {
    const host = hostOfBaseUrl(baseUrl);
    if (!host) return null;
    const exact = this.cache.get(host);
    if (exact) return exact;
    for (const [registered, channel] of this.cache) {
      if (host === registered || host.endsWith(`.${registered}`))
        return channel;
    }
    return null;
  }

  /** 当前渠道的别名表；未登记渠道返回空对象（原样透传） */
  resolveAliases(baseUrl: string): Record<string, string> {
    return this.resolveChannel(baseUrl)?.aliases ?? {};
  }

  async list(): Promise<LlmChannel[]> {
    return this.repo.find({ order: { host: 'ASC' } });
  }

  async upsert(
    host: string,
    patch: {
      label?: string;
      aliases?: Record<string, string>;
      note?: string | null;
    },
  ): Promise<LlmChannel> {
    const key = host.trim().toLowerCase();
    const existing = await this.repo.findOne({ where: { host: key } });
    const aliases = this.sanitizeAliases(
      patch.aliases ?? existing?.aliases ?? {},
    );
    const saved = await this.repo.save({
      host: key,
      label: patch.label ?? existing?.label ?? '',
      aliases,
      note: patch.note !== undefined ? patch.note : (existing?.note ?? null),
    });
    await this.reload();
    return saved;
  }

  async remove(host: string): Promise<void> {
    await this.repo.delete({ host: host.trim().toLowerCase() });
    await this.reload();
  }

  /** 用内建种子 upsert（幂等），返回登记条数 */
  async seedDefaults(): Promise<number> {
    for (const c of DEFAULT_CHANNELS) {
      await this.repo.save({
        host: c.host,
        label: c.label,
        aliases: this.sanitizeAliases(c.aliases),
        note: c.note,
      });
    }
    await this.reload();
    return this.repo.count();
  }

  /** 清洗别名表：仅保留非空字符串键值，避免脏数据污染转发路径 */
  private sanitizeAliases(raw: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [from, to] of Object.entries(raw)) {
      if (
        typeof from === 'string' &&
        from.trim() &&
        typeof to === 'string' &&
        to.trim()
      ) {
        out[from] = to;
      }
    }
    return out;
  }
}
