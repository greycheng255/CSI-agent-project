import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { HmacGuard } from '../contract/hmac.guard';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';
import {
  WORKSPACE_LIFECYCLE_EVENTS,
  WorkspacesService,
} from './workspaces.service';
import type { WorkspaceLifecycleEvent } from './workspaces.service';

/**
 * Console → M workspace 生命周期事件接收端点（契约 §21.3，W2）。
 * 三事件同端点；Console 出站凭证 = M 入站方向（HmacGuard）；
 * 全量快照幂等 upsert，M 侧按 event_id 去重（Idempotency-Key 头同值双保险）；
 * 投递为 best-effort，兜底走 M 侧 W1 Pull（since 水位增量）。
 */
@Controller('v1/webhooks/workspace')
@UseGuards(HmacGuard)
export class WorkspaceWebhookController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  /** POST /v1/webhooks/workspace/changed */
  @Post('changed')
  async changed(
    @Body()
    body: {
      event_id?: unknown;
      event_type?: unknown;
      data?: unknown;
    },
  ) {
    const eventId = body.event_id;
    if (typeof eventId !== 'string' || !eventId) {
      throw validationError('event_id is required');
    }
    if (
      typeof body.event_type !== 'string' ||
      !WORKSPACE_LIFECYCLE_EVENTS.includes(
        body.event_type as WorkspaceLifecycleEvent,
      )
    ) {
      throw validationError(
        `event_type must be one of ${WORKSPACE_LIFECYCLE_EVENTS.join('/')}`,
      );
    }
    const data =
      body.data && typeof body.data === 'object'
        ? (body.data as Record<string, unknown>)
        : {};
    // created/updated：data.workspace = PublicWorkspaceProfile 全量快照；
    // deleted：data = { workspace_id, deleted_at }（仅标识）
    const payload =
      body.event_type === 'workspace.deleted'
        ? data
        : ((data.workspace ?? null) as Record<string, unknown> | null);
    if (!payload || typeof payload !== 'object') {
      throw validationError('data.workspace is required');
    }

    const result = await this.workspacesService.applyLifecycle(
      eventId,
      body.event_type as WorkspaceLifecycleEvent,
      payload,
    );
    return { received: true, ...result };
  }
}

function validationError(message: string): ContractError {
  return new ContractError(
    400,
    CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
    message,
  );
}
