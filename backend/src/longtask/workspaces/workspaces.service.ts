import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from './workspace.entity';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';
import { WebhookDispatcherService } from '../contract/webhook-dispatcher.service';

export const WORKSPACE_LIFECYCLE_EVENTS = [
  'workspace.created',
  'workspace.updated',
  'workspace.deleted',
] as const;
export type WorkspaceLifecycleEvent = (typeof WORKSPACE_LIFECYCLE_EVENTS)[number];

const MAX_CAPABILITY_TAGS = 5;
const MAX_SHOWCASE_CASES = 6;

export interface CreateWorkspaceInput {
  ownerUserId?: string | null;
  orgId?: string | null;
  name: string;
  slug: string;
  logoUrl?: string | null;
  bio?: string | null;
  categoryIds?: string[] | null;
  capabilityTags?: string[] | null;
}

export interface UpdateShowcaseInput {
  bio?: string | null;
  capabilityTags?: string[] | null;
  announcement?: string | null;
  showcaseCases?: unknown[] | null;
  displayStatus?: 'active' | 'suspended' | 'frozen';
  receivePlatformPush?: boolean;
  serviceCommitments?: Record<string, unknown>;
}

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectRepository(Workspace)
    private readonly repo: Repository<Workspace>,
    private readonly dispatcher: WebhookDispatcherService,
  ) {}

  /** 创建 Workspace；slug 唯一（前置校验 + DB 唯一约束兜底） */
  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    if (
      input.capabilityTags &&
      input.capabilityTags.length > MAX_CAPABILITY_TAGS
    ) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        `capability_tags must not exceed ${MAX_CAPABILITY_TAGS} items`,
      );
    }
    const exists = await this.repo.findOne({ where: { slug: input.slug } });
    if (exists) {
      throw new ContractError(
        409,
        CONTRACT_ERROR_CODE.CONFLICT_SLUG,
        `workspace slug already exists: ${input.slug}`,
      );
    }
    const entity = this.repo.create({
      ownerUserId: input.ownerUserId ?? null,
      orgId: input.orgId ?? null,
      name: input.name,
      slug: input.slug,
      logoUrl: input.logoUrl ?? null,
      bio: input.bio ?? null,
      categoryIds: input.categoryIds ?? null,
      capabilityTags: input.capabilityTags ?? null,
      displayStatus: 'active',
    });
    return this.repo.save(entity);
  }

  findById(id: string): Promise<Workspace | null> {
    return this.repo.findOne({ where: { id } });
  }

  findBySlug(slug: string): Promise<Workspace | null> {
    return this.repo.findOne({ where: { slug } });
  }

  /** 按归属 Agent Owner（既有用户）查询其 AI 工作室 */
  findByOwner(ownerUserId: string): Promise<Workspace | null> {
    return this.repo.findOne({ where: { ownerUserId } });
  }

  /**
   * 已入驻工作室画廊（答复文档六：任务大厅/画廊消费投影）。
   * 仅返回 active 工作室，且只映射公开档案白名单字段（不含业务配置/预算/归属信息）。
   */
  async listGallery(): Promise<
    Array<Pick<Workspace, 'id' | 'name' | 'slug' | 'logoUrl' | 'bio' | 'categoryIds' | 'capabilityTags' | 'completedTasksCount' | 'avgRating' | 'announcement'>>
  > {
    const rows = await this.repo.find({
      where: { displayStatus: 'active' },
      order: { createdAt: 'DESC' },
    });
    return rows.map((ws) => ({
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      logoUrl: ws.logoUrl,
      bio: ws.bio,
      categoryIds: ws.categoryIds,
      capabilityTags: ws.capabilityTags,
      completedTasksCount: ws.completedTasksCount,
      avgRating: ws.avgRating,
      announcement: ws.announcement,
    }));
  }

  /** 展示页数据更新（案例 ≤6，信用字段只能平台计算写入） */
  async updateShowcase(
    id: string,
    patch: UpdateShowcaseInput,
  ): Promise<Workspace> {
    const ws = await this.repo.findOne({ where: { id } });
    if (!ws) {
      throw new ContractError(
        404,
        CONTRACT_ERROR_CODE.NOT_FOUND_WORKSPACE,
        `workspace not found: ${id}`,
      );
    }
    if (patch.showcaseCases && patch.showcaseCases.length > MAX_SHOWCASE_CASES) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        `showcase_cases must not exceed ${MAX_SHOWCASE_CASES} items`,
      );
    }
    if (patch.capabilityTags && patch.capabilityTags.length > MAX_CAPABILITY_TAGS) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        `capability_tags must not exceed ${MAX_CAPABILITY_TAGS} items`,
      );
    }
    if (patch.bio !== undefined) ws.bio = patch.bio;
    if (patch.capabilityTags !== undefined) ws.capabilityTags = patch.capabilityTags;
    if (patch.announcement !== undefined) ws.announcement = patch.announcement;
    if (patch.showcaseCases !== undefined) ws.showcaseCases = patch.showcaseCases;
    if (patch.displayStatus !== undefined) ws.displayStatus = patch.displayStatus;
    if (patch.receivePlatformPush !== undefined)
      ws.receivePlatformPush = patch.receivePlatformPush;
    if (patch.serviceCommitments !== undefined)
      ws.serviceCommitments = patch.serviceCommitments;
    return this.repo.save(ws);
  }

  /** Push 模式匹配目标（按类目 + 接收推送开关 + 状态正常）；阶段二消费 */
  matchForPush(categoryId: string): Promise<Workspace[]> {
    return this.repo
      .createQueryBuilder('ws')
      .where('ws.display_status = :status', { status: 'active' })
      .andWhere('ws.receive_platform_push = :receive', { receive: true })
      .andWhere(
        isSqliteArrayColumn()
          ? "ws.category_ids LIKE :cat"
          : ':cat = ANY(ws.category_ids)',
        { cat: `%${categoryId}%` },
      )
      .getMany();
  }

  /**
   * Console → M workspace 生命周期事件（契约 §21.3：created/updated/deleted，无 suspended）：
   * event_id 去重 → payload 为 PublicWorkspaceProfile 全量快照（幂等 upsert）。
   * 字段映射：workspace_id→id、avatar_url→logoUrl、description→bio、slug 直取；
   * workspace.deleted → displayStatus=frozen（停止展示与投递；active 排除在画廊与 matchForPush 之外）。
   * 返回 duplicate=true 时调用方直接 ACK 丢弃。
   */
  async applyLifecycle(
    eventId: string,
    eventType: WorkspaceLifecycleEvent,
    payload: Record<string, unknown>,
  ): Promise<{ duplicate: boolean; workspace: Workspace | null }> {
    const first = await this.dispatcher.recordInbound(eventId, eventType);
    if (!first) {
      const wsId = payload.workspace_id ?? payload.id;
      const existing = await this.repo.findOne({
        where: { id: String(wsId ?? '') },
      });
      return { duplicate: true, workspace: existing ?? null };
    }

    const wsId = payload.workspace_id ?? payload.id;
    if (typeof wsId !== 'string' || !wsId) {
      throw new ContractError(
        400,
        CONTRACT_ERROR_CODE.VALIDATION_INVALID_PAYLOAD,
        'workspace_id is required',
      );
    }
    let ws = await this.repo.findOne({ where: { id: wsId } });

    // deleted：仅标识（无档案），终止态 → frozen（停止展示与投递）
    if (eventType === 'workspace.deleted') {
      if (!ws) return { duplicate: false, workspace: null };
      ws.displayStatus = 'frozen';
      return { duplicate: false, workspace: await this.repo.save(ws) };
    }

    if (!ws) {
      ws = this.repo.create({
        id: wsId,
        name: '',
        slug: typeof payload.slug === 'string' && payload.slug ? payload.slug : `c-${wsId}`,
      });
    }

    // 公开档案白名单映射（§21.2：不含任何业务配置/预算数据）
    if (typeof payload.name === 'string' && payload.name) ws.name = payload.name;
    if (typeof payload.slug === 'string' && payload.slug) ws.slug = payload.slug;
    if (typeof payload.avatar_url === 'string') ws.logoUrl = payload.avatar_url;
    if (typeof payload.description === 'string') ws.bio = payload.description;
    if (Array.isArray(payload.capability_tags)) {
      ws.capabilityTags = payload.capability_tags as string[];
      // Console 快照权威（2026-09-06 联调定论）：能力标签即类目匹配依据，
      // 同步写入 category_ids，pushTask/matchForPush 双路径才能命中
      ws.categoryIds = payload.capability_tags as string[];
    }
    if (
      payload.service_commitments &&
      typeof payload.service_commitments === 'object' &&
      !Array.isArray(payload.service_commitments)
    ) {
      ws.serviceCommitments = payload.service_commitments as Record<string, unknown>;
    }
    // Console 权威快照表明 workspace 存在——自愈本地终止态
    if (ws.displayStatus === 'frozen') ws.displayStatus = 'active';

    const workspace = await this.repo.save(ws);
    return { duplicate: false, workspace };
  }
}

function isSqliteArrayColumn(): boolean {
  return process.env.DB_TYPE === 'sqlite';
}