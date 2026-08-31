import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from './workspace.entity';
import {
  CONTRACT_ERROR_CODE,
  ContractError,
} from '../contract/errors';

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
}

function isSqliteArrayColumn(): boolean {
  return process.env.DB_TYPE === 'sqlite';
}