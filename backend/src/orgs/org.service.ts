import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Org } from './entities/org.entity';

/** 账号摘要：仅用于 org 自动绑定/解析，不依赖完整 User 实体 */
export type AccountRef = {
  id: string;
  phone?: string | null;
  displayName?: string | null;
};

/**
 * 统一账户体系 Org 解析与自动绑定。
 *
 * 设计要点：
 * - ensureForUser 幂等：账号已绑定 org 时直接返回，否则生成并绑定。
 * - slug 全局唯一：生成冲突时重试（极低概率）。
 * - 不涉及 IAM（多 org / 成员 / 角色），公测版一账号一 org。
 */
@Injectable()
export class OrgService {
  private readonly logger = new Logger(OrgService.name);

  constructor(
    @InjectRepository(Org)
    private readonly orgsRepository: Repository<Org>,
  ) {}

  /**
   * 确保账号已绑定 org；缺失则生成并绑定。
   * 在账号注册 / 短信登录首次创建账号时调用。
   */
  async ensureForUser(account: AccountRef): Promise<Org> {
    const existing = await this.orgsRepository.findOne({
      where: { ownerUserId: account.id },
    });
    if (existing) {
      return existing;
    }

    const baseName =
      account.displayName?.trim() ||
      (account.phone ? `账号${account.phone.slice(-4)}` : '我的组织');
    const slugSeed = randomBytes(6).toString('base64url').slice(0, 8);
    const slug = `org-${slugSeed}`;

    let org = this.orgsRepository.create({
      ownerUserId: account.id,
      slug,
      name: baseName,
    });

    // slug 全局唯一约束冲突时重试若干次
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        org = await this.orgsRepository.save(org);
        this.logger.log(`Org created for user ${account.id}: ${org.id}`);
        return org;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/unique|duplicate/i.test(message) && attempt < 2) {
          org.slug = `org-${randomBytes(6).toString('base64url').slice(0, 8)}`;
          continue;
        }
        throw err;
      }
    }
    // 理论不可达；满足类型流转
    return org;
  }

  /** 账号→org 解析（OIDC claim 的兜底 API 使用） */
  async resolveByUserId(userId: string): Promise<Org | null> {
    return this.orgsRepository.findOne({
      where: { ownerUserId: userId },
    });
  }

  /** 仅返回 org_id（消费方仅需不透明计费键时使用） */
  async getOrgIdForUser(userId: string): Promise<string | null> {
    const org = await this.resolveByUserId(userId);
    return org?.id ?? null;
  }

  /** 按 org_id 反查（计费/网关侧校验归属用） */
  async resolveByOrgId(orgId: string): Promise<Org | null> {
    return this.orgsRepository.findOne({ where: { id: orgId } });
  }
}
