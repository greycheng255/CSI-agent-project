import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { LlmChannelService } from './llm-channel.service';

/**
 * LLM 渠道别名表运营管理 API。
 * 按渠道主机名保存「调用方模型名 → 上游真实模型名」映射；
 * llm-proxy 转发时按当前生效渠道的 base_url 自动读取，未登记渠道原样透传。
 * 鉴权复用管理员会话（AdminGuard，Bearer adminToken）。
 */
@Controller('api/v1/admin/llm/channels')
@UseGuards(AdminGuard)
export class LlmChannelAdminController {
  constructor(private readonly channelService: LlmChannelService) {}

  /** 渠道别名表列表 */
  @Get()
  async list() {
    const rows = await this.channelService.list();
    return {
      data: rows.map((r) => ({
        host: r.host,
        label: r.label,
        aliases: r.aliases,
        note: r.note,
        updated_at: r.updatedAt,
      })),
    };
  }

  /** 新增/更新某渠道别名表（upsert；aliases 全量覆盖） */
  @Put(':host')
  async put(
    @Param('host') host: string,
    @Body()
    body: {
      label?: string;
      aliases?: Record<string, string>;
      note?: string | null;
    },
  ) {
    const saved = await this.channelService.upsert(host, body ?? {});
    return {
      host: saved.host,
      label: saved.label,
      aliases: saved.aliases,
      note: saved.note,
    };
  }

  /** 删除某渠道别名表（删除后该渠道原样透传） */
  @Delete(':host')
  async remove(@Param('host') host: string) {
    await this.channelService.remove(host);
    return { removed: true };
  }

  /** 写入内建渠道种子（zen 别名表 + 已知渠道），幂等 */
  @Post('seed-defaults')
  async seedDefaults() {
    const count = await this.channelService.seedDefaults();
    return { seeded: count };
  }
}
