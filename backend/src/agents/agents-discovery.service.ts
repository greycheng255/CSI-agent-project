import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  Agent,
  AgentApprovalStatus,
  AgentRuntimeStatus,
} from './entities/agent.entity';
import { AgentTag } from './entities/agent-tag.entity';

@Injectable()
export class AgentsDiscoveryService {
  constructor(
    @InjectRepository(Agent)
    private readonly agentsRepository: Repository<Agent>,
    @InjectRepository(AgentTag)
    private readonly tagsRepository: Repository<AgentTag>,
  ) {}

  async discover(query: {
    query?: string;
    tags?: string[] | string;
    skills?: string[] | string;
    domains?: string[] | string;
    runtimeStatus?: string;
    limit?: number;
    offset?: number;
  }) {
    const tags = this.toList(query.tags);
    const skills = this.toList(query.skills);
    const domains = this.toList(query.domains);
    const keyword = query.query?.trim();

    const qb = this.agentsRepository
      .createQueryBuilder('agent')
      .leftJoinAndSelect('agent.capabilities', 'capability')
      .leftJoinAndSelect('agent.tags', 'tag')
      .where('agent.approval_status = :approvalStatus', {
        approvalStatus: AgentApprovalStatus.APPROVED,
      })
      .andWhere('agent.is_active = :isActive', { isActive: true })
      .andWhere('agent.visibility = :visibility', { visibility: 'public' })
      .andWhere('agent.runtime_status IN (:...runtimeStatuses)', {
        runtimeStatuses: [
          AgentRuntimeStatus.ONLINE,
          AgentRuntimeStatus.DEGRADED,
        ],
      })
      .distinct(true);

    if (query.runtimeStatus) {
      qb.andWhere('agent.runtime_status = :runtimeStatus', {
        runtimeStatus: query.runtimeStatus,
      });
    }

    if (keyword) {
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('LOWER(agent.name) LIKE :keyword', {
              keyword: `%${keyword.toLowerCase()}%`,
            })
            .orWhere('LOWER(agent.description) LIKE :keyword', {
              keyword: `%${keyword.toLowerCase()}%`,
            })
            .orWhere('LOWER(capability.name) LIKE :keyword', {
              keyword: `%${keyword.toLowerCase()}%`,
            })
            .orWhere('LOWER(tag.tag) LIKE :keyword', {
              keyword: `%${keyword.toLowerCase()}%`,
            });
        }),
      );
    }

    const capabilityFilters = [
      ...skills.map((name) => ({ type: 'skill', name })),
      ...domains.map((name) => ({ type: 'domain', name })),
    ];

    if (capabilityFilters.length > 0) {
      qb.andWhere(
        new Brackets((sub) => {
          capabilityFilters.forEach((filter, index) => {
            const expression = `(capability.capability_type = :capabilityType${index} AND LOWER(capability.name) = :capabilityName${index})`;
            const params = {
              [`capabilityType${index}`]: filter.type,
              [`capabilityName${index}`]: filter.name.toLowerCase(),
            };
            if (index === 0) sub.where(expression, params);
            else sub.orWhere(expression, params);
          });
        }),
      );
    }

    if (tags.length > 0) {
      qb.andWhere('LOWER(tag.tag) IN (:...tags)', {
        tags: tags.map((tag) => tag.toLowerCase()),
      });
    }

    qb.orderBy('agent.runtimeStatus', 'ASC')
      .addOrderBy('agent.reputationScore', 'DESC')
      .addOrderBy('agent.createdAt', 'DESC')
      .skip(query.offset || 0)
      .take(Math.min(query.limit || 20, 100));

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  async listTags() {
    const rows = await this.tagsRepository
      .createQueryBuilder('tag')
      .select('tag.tag', 'tag')
      .addSelect('tag.tagType', 'tagType')
      .addSelect('COUNT(tag.id)', 'count')
      .groupBy('tag.tag')
      .addGroupBy('tag.tagType')
      .orderBy('count', 'DESC')
      .getRawMany<{ tag: string; tagType: string; count: string }>();

    return rows.map((row) => ({
      tag: row.tag,
      tagType: row.tagType,
      count: Number(row.count),
    }));
  }

  private toList(value?: string[] | string) {
    if (!value) return [];
    const items = Array.isArray(value) ? value : value.split(',');
    return items
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
