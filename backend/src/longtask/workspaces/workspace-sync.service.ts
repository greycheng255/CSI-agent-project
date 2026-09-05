import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { signPayload } from '../contract/hmac-sign';
import { WorkspacesService } from './workspaces.service';

/**
 * W1 拉取同步 client（契约 §21.2 端点一：GET /v1/partner/workspaces，M→C 只读）。
 * M 侧投影模式的兜底通道：W2 事件 best-effort，丢失时由本同步（全量翻页 + 幂等 upsert）收敛。
 * 鉴权：方向分离出站凭证（Bearer LONGTASK_OUTBOUND_TOKEN）+ HMAC——GET 无 body，
 * 签名输入为空串（§21.1：t=<unix>,v1=<hex(HMAC-SHA256(secret, ""+t))>）。
 * 幂等：复用 applyLifecycle——合成 event_id=`sync-{workspace_id}-{updated_at}`，内容未变走去重跳过。
 */
const CONSOLE_WORKSPACE_LIST_PATH = '/v1/partner/workspaces';
const SYNC_INTERVAL_MS = 30 * 60 * 1000;
const PAGE_LIMIT = 200;
const MAX_PAGES = 50; // 防御：cursor 异常时避免死循环

/** §21.2 PublicWorkspaceProfile（M 侧消费所需字段；snake_case 原样透传给 applyLifecycle） */
export interface PublicWorkspaceProfile {
  workspace_id: string;
  name?: string;
  slug?: string;
  description?: string | null;
  avatar_url?: string | null;
  capability_tags?: string[];
  service_commitments?: Record<string, unknown>;
  agent_count?: number;
  created_at?: string;
  updated_at?: string;
}

interface WorkspaceListResponse {
  workspaces?: PublicWorkspaceProfile[];
  next_cursor?: string | null;
}

@Injectable()
export class WorkspaceSyncService {
  private readonly logger = new Logger(WorkspaceSyncService.name);

  constructor(private readonly workspacesService: WorkspacesService) {}

  /**
   * 拉取一次全量（cursor 翻页；since 缺省 = 全量，幂等 upsert 无需水位列）。
   * 返回 Console 侧最大 updated_at，供调用方记录水位；异常抛出交由 cron 告警。
   */
  async syncOnce(fetchFn: typeof fetch = fetch): Promise<{ upserted: number; watermark: string | null }> {
    const base = process.env.CONSOLE_BASE_URL;
    if (!base) {
      throw new Error('CONSOLE_BASE_URL is not configured');
    }
    const origin = base.replace(/\/+$/, '');

    let cursor: string | null = null;
    let upserted = 0;
    let watermark: string | null = null;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(`${origin}${CONSOLE_WORKSPACE_LIST_PATH}`);
      url.searchParams.set('limit', String(PAGE_LIMIT));
      if (cursor) url.searchParams.set('cursor', cursor);

      const res = await fetchFn(url.toString(), {
        headers: this.authHeaders(),
      });
      if (!res.ok) {
        throw new Error(`console workspace list HTTP ${res.status}`);
      }
      const data = (await res.json()) as WorkspaceListResponse;
      const items = Array.isArray(data.workspaces) ? data.workspaces : [];

      for (const item of items) {
        if (typeof item?.workspace_id !== 'string' || !item.workspace_id) continue;
        await this.workspacesService.applyLifecycle(
          `sync-${item.workspace_id}-${item.updated_at ?? ''}`,
          'workspace.updated',
          item as unknown as Record<string, unknown>,
        );
        upserted += 1;
        if (item.updated_at && (!watermark || item.updated_at > watermark)) {
          watermark = item.updated_at;
        }
      }

      cursor = data.next_cursor ?? null;
      if (!cursor) break;
    }

    return { upserted, watermark };
  }

  /** 每 30min 同步；仅在显式开启且配置了 Console 地址时运行 */
  @Interval(SYNC_INTERVAL_MS)
  async syncCron(): Promise<void> {
    if (
      process.env.WORKSPACE_SYNC_ENABLED !== 'true' ||
      !process.env.CONSOLE_BASE_URL
    ) {
      return;
    }
    try {
      const { upserted, watermark } = await this.syncOnce();
      if (upserted > 0) {
        this.logger.log(`workspace sync: upserted=${upserted} watermark=${watermark ?? 'n/a'}`);
      }
    } catch (err) {
      this.logger.warn(`workspace sync failed: ${String(err)}`);
    }
  }

  /** §21.1 鉴权头：方向分离出站凭证 + HMAC 空 body 签名 + nonce */
  private authHeaders(): Record<string, string> {
    const token =
      process.env.LONGTASK_OUTBOUND_TOKEN ??
      process.env.LONGTASK_SERVICE_TOKEN ??
      '';
    const ts = Math.floor(Date.now() / 1000);
    return {
      Authorization: `Bearer ${token}`,
      // GET 无 body → 签名输入为空串（§21.1）
      'X-Signature': `t=${ts},v1=${signPayload('', ts, token)}`,
      'X-Request-Id': randomUUID(),
    };
  }
}
