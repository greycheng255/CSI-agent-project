import { Injectable, Logger } from '@nestjs/common';
import { WechatTokenService } from './wechat-token.service';

export interface WechatTemplateData {
  [key: string]: string;
}

export interface TemplateSendResult {
  /** 是否到达终态（true=无需再试；含成功与 skip） */
  done: boolean;
  delivered: boolean;
  /** 是否值得由调度层退避重试（网络/5xx/token 失效） */
  retryable: boolean;
  error?: string;
}

const SEND_TEMPLATE_URL = 'https://api.weixin.qq.com/cgi-bin/message/template/send';
// token 失效（40001/42001/42002）或文案超限（45009 频率）可按退避重试
const RETRYABLE_ERRCODES = new Set([40001, 42001, 42002, 429, 45009]);

/**
 * 微信公众号模板消息发送（原生 API）：
 * - 未配置模板 ID / 无 openid → done=true（skip，不重试）
 * - errcode===0 → done=true delivered=true
 * - token 失效等可恢复错误 → retryable=true
 * - 其余业务错误（如 invalid openid 40003）→ done=true（死信）
 */
@Injectable()
export class WechatTemplateService {
  private readonly logger = new Logger(WechatTemplateService.name);

  constructor(private readonly tokenService: WechatTokenService) {}

  /** mock 模式：不调微信真实 API，模拟发送成功，用于验证出站 outbox 全流程 */
  private mock(): boolean {
    return process.env.WECHAT_MOCK_MODE?.trim() === 'true';
  }

  async send(
    openid: string,
    templateId: string,
    data: WechatTemplateData,
  ): Promise<TemplateSendResult> {
    if (!templateId || !openid) {
      return { done: true, delivered: false, retryable: false };
    }

    if (this.mock()) {
      this.logger.log(
        `[mock] template send openid=${openid} template=${templateId} data=${JSON.stringify(data)}`,
      );
      return { done: true, delivered: true, retryable: false };
    }

    let accessToken: string;
    try {
      accessToken = await this.tokenService.getAccessToken();
    } catch (err) {
      return {
        done: false,
        delivered: false,
        retryable: true,
        error: `token:${String((err as Error).message)}`,
      };
    }

    const params = new URLSearchParams({ access_token: accessToken });
    const body = JSON.stringify({
      touser: openid,
      template_id: templateId,
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, { value: String(v) }]),
      ),
    });

    let res: Response;
    try {
      res = await fetch(`${SEND_TEMPLATE_URL}?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (err) {
      return {
        done: false,
        delivered: false,
        retryable: true,
        error: `network:${String((err as Error).message)}`,
      };
    }

    let json: Record<string, unknown>;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      return {
        done: false,
        delivered: false,
        retryable: true,
        error: `http-${res.status}`,
      };
    }

    const errcode = json.errcode as number;
    if (errcode === 0) {
      return { done: true, delivered: true, retryable: false };
    }
    if (RETRYABLE_ERRCODES.has(errcode)) {
      if (errcode === 40001 || errcode === 42001 || errcode === 42002) {
        await this.tokenService.invalidate();
      }
      return {
        done: false,
        delivered: false,
        retryable: true,
        error: `errcode=${errcode} errmsg=${json.errmsg}`,
      };
    }
    // 其余（40003 invalid openid、40037 模板非法、待配置等）→ 终态死信
    return {
      done: true,
      delivered: false,
      retryable: false,
      error: `errcode=${errcode} errmsg=${json.errmsg}`,
    };
  }
}