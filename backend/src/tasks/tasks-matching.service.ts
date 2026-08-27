import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Agent,
  AgentApprovalStatus,
  AgentRuntimeStatus,
} from '../agents/entities/agent.entity';
import { AgentCapability } from '../agents/entities/agent-capability.entity';
import { AgentTag } from '../agents/entities/agent-tag.entity';
import { Task } from './entities/task.entity';

export type MatchedAgent = Agent & { matchScore?: number; matchedReasons?: string[] };

@Injectable()
export class TasksMatchingService {
  constructor(
    @InjectRepository(Agent)
    private readonly agentsRepository: Repository<Agent>,
    @InjectRepository(AgentTag)
    private readonly tagsRepository: Repository<AgentTag>,
    @InjectRepository(AgentCapability)
    private readonly capabilitiesRepository: Repository<AgentCapability>,
  ) {}

  private normalize(values: Array<string | null | undefined>) {
    return Array.from(
      new Set(
        values
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
      ),
    );
  }

  async matchTask(task: Task, limit = 10): Promise<MatchedAgent[]> {
    const taskTags = this.normalize(task.tags || []);
    const skills = this.normalize(task.skillsRequired || []);
    const keywords = this.normalize([
      ...taskTags,
      ...skills,
      ...(task.title || '').split(/\s+/),
      ...(task.description || '').split(/\s+/),
    ]);

    const candidates = await this.agentsRepository.find({
      where: {
        approvalStatus: AgentApprovalStatus.APPROVED,
        isActive: true,
        runtimeStatus: In([
          AgentRuntimeStatus.ONLINE,
          AgentRuntimeStatus.DEGRADED,
        ]),
      },
      relations: ['owner'],
      take: 100,
    });
    if (candidates.length === 0) return [];

    const ids = candidates.map((agent) => agent.id);
    const [tags, capabilities] = await Promise.all([
      ids.length
        ? this.tagsRepository.find({ where: { agent: { id: In(ids) } }, relations: ['agent'] })
        : Promise.resolve([]),
      ids.length
        ? this.capabilitiesRepository.find({ where: { agent: { id: In(ids) } }, relations: ['agent'] })
        : Promise.resolve([]),
    ]);

    const tagMap = new Map<string, string[]>();
    for (const tag of tags) {
      const list = tagMap.get(tag.agent.id) || [];
      list.push(tag.tag);
      tagMap.set(tag.agent.id, list);
    }

    const capabilityMap = new Map<string, string[]>();
    for (const capability of capabilities) {
      const list = capabilityMap.get(capability.agent.id) || [];
      list.push(capability.name);
      capabilityMap.set(capability.agent.id, list);
    }

    return candidates
      .map((agent) => {
        const agentTags = this.normalize(tagMap.get(agent.id) || []);
        const agentCapabilities = this.normalize([
          ...(capabilityMap.get(agent.id) || []),
          ...(agent.skills || []),
        ]);

        const tagHits = taskTags.filter((tag) => agentTags.includes(tag)).length;
        const skillHits = skills.filter((skill) =>
          agentCapabilities.some((capability) => capability.includes(skill) || skill.includes(capability)),
        ).length;
        const textHits = keywords.filter((keyword) =>
          agentCapabilities.some((capability) => capability.includes(keyword)) ||
          agentTags.some((tag) => tag.includes(keyword)),
        ).length;

        const reputation = Number(agent.reputationScore || 0);
        const runtimeBoost = agent.runtimeStatus === AgentRuntimeStatus.ONLINE ? 0.15 : 0.08;
        const score =
          tagHits * 0.25 +
          skillHits * 0.35 +
          Math.min(textHits, 5) * 0.05 +
          Math.min(reputation / 5, 1) * 0.2 +
          runtimeBoost;

        return {
          ...agent,
          matchScore: Number(score.toFixed(4)),
          matchedReasons: [
            tagHits > 0 ? `${tagHits} tag matches` : '',
            skillHits > 0 ? `${skillHits} skill matches` : '',
            agent.runtimeStatus,
          ].filter(Boolean),
        };
      })
      .filter((agent) => (agent.matchScore || 0) > 0 || keywords.length === 0)
      .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))
      .slice(0, limit);
  }
}
