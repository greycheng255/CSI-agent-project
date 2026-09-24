import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { HmacGuard } from '../longtask/contract/hmac.guard';
import { ContractError } from '../longtask/contract/errors';
import { CsiOrgBinding } from './csi-org-binding.entity';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string, field: string): string {
  if (!value || !UUID_RE.test(value)) {
    throw new ContractError(400, 'INVALID_ARGUMENT', `${field} must be a valid UUID`);
  }
  return value;
}

/**
 * org 分配 API（统一账户体系公测过渡实现，权威源）。
 * Console 在注册/创建 workspace 时调用 O1 幂等解析 org_id；
 * 鉴权与 /v1/entitlement/* 同构（长任务契约 HMAC 四件套）。
 */
@Controller('v1/orgs')
@UseGuards(HmacGuard)
export class OrgsController {
  constructor(
    @InjectRepository(CsiOrgBinding)
    private readonly bindingsRepo: Repository<CsiOrgBinding>,
  ) {}

  /**
   * O1：workspace → org 幂等解析。
   * 已绑定返回既有 org_id（created=false）；未绑定生成新 org 落库（created=true）。
   * 并发同 workspace 重复调用安全：orIgnore + 回读，返回同一 org_id。
   */
  @Post('resolve')
  async resolve(@Body() body: { workspace_id?: string }) {
    const workspaceId = requireUuid(body?.workspace_id ?? '', 'workspace_id');
    const existing = await this.bindingsRepo.findOne({
      where: { workspaceId },
    });
    if (existing) {
      return {
        workspace_id: workspaceId,
        org_id: existing.orgId,
        created: false,
      };
    }
    await this.bindingsRepo
      .createQueryBuilder()
      .insert()
      .into(CsiOrgBinding)
      .values({ workspaceId, orgId: randomUUID(), source: 'api' })
      .orIgnore()
      .execute();
    const row = await this.bindingsRepo.findOne({
      where: { workspaceId },
    });
    if (!row) {
      // 理论不可达：orIgnore 后必有一行
      throw new ContractError(503, 'ORG_RESOLVE_FAILED', 'org binding insert failed');
    }
    return { workspace_id: workspaceId, org_id: row.orgId, created: true };
  }

  /** O2：绑定查询（排查用，无绑定为业务态 → 404 NOT_FOUND_ORG_BINDING） */
  @Get('bindings/:workspaceId')
  async getBinding(@Param('workspaceId') workspaceId: string) {
    const ws = requireUuid(workspaceId, 'workspace_id');
    const row = await this.bindingsRepo.findOne({ where: { workspaceId: ws } });
    if (!row) {
      throw new ContractError(
        404,
        'NOT_FOUND_ORG_BINDING',
        `no org binding for workspace: ${ws}`,
      );
    }
    return {
      workspace_id: ws,
      org_id: row.orgId,
      source: row.source,
      resolved_at: row.resolvedAt,
    };
  }
}
