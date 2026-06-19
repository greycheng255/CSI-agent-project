import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
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
    const limit = Math.min(query.limit || 20, 100);

    // 步骤1: 只查 agent ID（不加 JOIN，避免笛卡尔积）
    const idQb = this.agentsRepository
      .createQueryBuilder('agent')
      .select('agent.id', 'id')
      .addSelect('agent.runtimeStatus')
      .addSelect('agent.reputationScore')
      .addSelect('agent.createdAt')
      .where('agent.approvalStatus = :approvalStatus', {
        approvalStatus: AgentApprovalStatus.APPROVED,
      })
      .andWhere('agent.isActive = :isActive', { isActive: true })
      .andWhere('agent.visibility = :visibility', { visibility: 'public' })
      .andWhere('agent.runtimeStatus IN (:...runtimeStatuses)', {
        runtimeStatuses: [AgentRuntimeStatus.ONLINE, AgentRuntimeStatus.DEGRADED],
      });

    if (query.runtimeStatus) {
      idQb.andWhere('agent.runtimeStatus = :runtimeStatus', {
        runtimeStatus: query.runtimeStatus,
      });
    }

    if (keyword) {
      idQb.andWhere(
        new Brackets((sub) => {
          sub
            .where('LOWER(agent.name) LIKE :keyword', {
              keyword: `%${keyword.toLowerCase()}%`,
            })
            .orWhere('LOWER(agent.description) LIKE :keyword', {
              keyword: `%${keyword.toLowerCase()}%`,
            });
        }),
      );
    }

    // 技能/领域过滤：用 EXISTS 子查询代替 JOIN
    const capabilityFilters = [
      ...skills.map((name) => ({ type: 'skill', name })),
      ...domains.map((name) => ({ type: 'domain', name })),
    ];
    if (capabilityFilters.length > 0) {
      capabilityFilters.forEach((filter, index) => {
        idQb.andWhere(
          `EXISTS (SELECT 1 FROM agent_capabilities c${index} WHERE c${index}.agent_id = agent.id AND c${index}.capability_type = :ct${index} AND LOWER(c${index}.name) = :cn${index})`,
          {
            [`ct${index}`]: filter.type,
            [`cn${index}`]: filter.name.toLowerCase(),
          },
        );
      });
    }

    // 标签过滤
    if (tags.length > 0) {
      idQb.andWhere(
        `EXISTS (SELECT 1 FROM agent_tags t WHERE t.agent_id = agent.id AND LOWER(t.tag) IN (:...tags))`,
        { tags: tags.map((t) => t.toLowerCase()) },
      );
    }

    // 计数
    const total = await idQb.getCount();

    // 分页
    const idRows = await idQb
      .orderBy('agent.runtimeStatus', 'ASC')
      .addOrderBy('agent.reputationScore', 'DESC')
      .addOrderBy('agent.createdAt', 'DESC')
      .skip(query.offset || 0)
      .take(limit)
      .getRawMany<{ id: string }>();

    const agentIds = idRows.map((r) => r.id);

    if (agentIds.length === 0) {
      return { items: [], total };
    }

    // 步骤2: 用 ID 批量加载完整 Agent + 关联数据
    const items = await this.agentsRepository.find({
      where: { id: In(agentIds) },
      relations: ['capabilities', 'tags'],
    });

    // 保持排序
    const idOrder = new Map(agentIds.map((id, i) => [id, i]));
    items.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

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
    return items.map((item) => item.trim()).filter(Boolean);
  }
}
