import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { LlmProxyService } from './llm-proxy.service';
import { LlmModelPriceService } from './llm-model-price.service';

/**
 * LLM 计费单价运营管理 API。
 * 管理员可在线查看/改价、以内建价或网关实际模型清单初始化。
 * 鉴权复用管理员会话（AdminGuard，Bearer adminToken）。
 */
@Controller('api/v1/admin/llm/price')
@UseGuards(AdminGuard)
export class LlmPriceAdminController {
  constructor(
    private readonly priceService: LlmModelPriceService,
    private readonly proxy: LlmProxyService,
  ) {}

  /** 价格列表 */
  @Get()
  async list() {
    const rows = await this.priceService.list();
    return {
      data: rows.map((r) => ({
        model: r.modelName,
        input_price: r.inputPrice,
        output_price: r.outputPrice,
      })),
    };
  }

  /** 新增/更新某个模型单价（upsert） */
  @Put(':model')
  async put(
    @Param('model') model: string,
    @Body() body: { input_price?: number; output_price?: number },
  ) {
    const input = Math.max(0, Number(body.input_price ?? 0));
    const output = Math.max(0, Number(body.output_price ?? 0));
    const saved = await this.priceService.upsert(model, input, output);
    return { model: saved.modelName, input_price: saved.inputPrice, output_price: saved.outputPrice };
  }

  /** 删除某个模型单价 */
  @Delete(':model')
  async remove(@Param('model') model: string) {
    await this.priceService.remove(model);
    return { removed: true };
  }

  /** 用内建默认价初始化种子 */
  @Post('seed-internal')
  async seedInternal() {
    const count = await this.priceService.seedFromInternal();
    return { seeded: count };
  }

  /**
   * 从指定 org 的网关拉取 /v1/models 清单初始化。
   * body.orgId 指定用于桥接拉取模型清单的 org（BYOK 网关配置）。
   * 新模型按默认回退价登记。
   */
  @Post('seed-gateway')
  async seedGateway(@Body() body: { orgId?: string }) {
    const orgId = body?.orgId;
    if (!orgId) {
      return { error: 'orgId required' as string };
    }
    const result = await this.proxy.forward(orgId, undefined, { endpoint: 'models' });
    if (result.mode !== 'json' || typeof result.body !== 'object' || !result.body) {
      return { error: 'gateway models unavailable' };
    }
    const data = (result.body as { data?: { id?: string }[] })?.data ?? [];
    let created = 0;
    for (const m of data) {
      if (!m?.id) continue;
      const fallback = this.priceService.getPriceOrFallback(m.id);
      await this.priceService.upsert(m.id, fallback.input, fallback.output);
      created++;
    }
    return { created };
  }
}