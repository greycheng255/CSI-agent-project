import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import {
  Agent,
  AgentRuntimeStatus,
  AgentStatus,
} from './entities/agent.entity';
import { AgentHeartbeat } from './entities/agent-heartbeat.entity';

@Injectable()
export class AgentsHealthService {
  private readonly degradedMs =
    Number(process.env.AGENT_HEARTBEAT_DEGRADED_SECONDS || 90) * 1000;
  private readonly offlineMs =
    Number(process.env.AGENT_HEARTBEAT_OFFLINE_SECONDS || 180) * 1000;

  constructor(
    @InjectRepository(Agent)
    private readonly agentsRepository: Repository<Agent>,
    @InjectRepository(AgentHeartbeat)
    private readonly heartbeatsRepository: Repository<AgentHeartbeat>,
  ) {}

  async recordHeartbeat(
    agentId: string,
    body?: {
      status?: string;
      latencyMs?: number;
      load?: number;
      metadata?: Record<string, unknown>;
    },
  ) {
    const agent = await this.agentsRepository.findOne({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Agent not found');

    const now = new Date();
    const runtimeStatus = this.normalizeRuntimeStatus(body?.status);

    await this.heartbeatsRepository.save(
      this.heartbeatsRepository.create({
        agent,
        status: runtimeStatus,
        latencyMs: body?.latencyMs ?? null,
        loadMetric: body?.load ?? null,
        metadata: body?.metadata ?? null,
      }),
    );

    agent.lastHeartbeatAt = now;
    agent.runtimeStatus = runtimeStatus as AgentRuntimeStatus;
    agent.status =
      runtimeStatus === AgentRuntimeStatus.OFFLINE
        ? AgentStatus.OFFLINE
        : AgentStatus.ONLINE;
    agent.consecutiveFailures = 0;
    await this.agentsRepository.save(agent);

    return {
      success: true,
      agentId: agent.id,
      runtimeStatus: agent.runtimeStatus,
      status: agent.status,
      timestamp: now,
    };
  }

  async refreshTimeoutStatuses() {
    const now = Date.now();
    const offlineThreshold = new Date(now - this.offlineMs);
    const degradedThreshold = new Date(now - this.degradedMs);

    const offlineAgents = await this.agentsRepository.find({
      where: {
        runtimeStatus: AgentRuntimeStatus.ONLINE,
        lastHeartbeatAt: LessThan(degradedThreshold),
      },
    });

    let changed = 0;
    for (const agent of offlineAgents) {
      const last = agent.lastHeartbeatAt?.getTime() || 0;
      if (last > 0 && now - last >= this.offlineMs) {
        agent.runtimeStatus = AgentRuntimeStatus.OFFLINE;
        agent.status = AgentStatus.OFFLINE;
      } else {
        agent.runtimeStatus = AgentRuntimeStatus.DEGRADED;
        agent.status = AgentStatus.ONLINE;
      }
      await this.agentsRepository.save(agent);
      changed += 1;
    }

    const staleDegradedAgents = await this.agentsRepository.find({
      where: {
        runtimeStatus: AgentRuntimeStatus.DEGRADED,
        lastHeartbeatAt: LessThan(offlineThreshold),
      },
    });
    for (const agent of staleDegradedAgents) {
      agent.runtimeStatus = AgentRuntimeStatus.OFFLINE;
      agent.status = AgentStatus.OFFLINE;
      await this.agentsRepository.save(agent);
      changed += 1;
    }

    return changed;
  }

  private normalizeRuntimeStatus(status?: string) {
    if (
      status === AgentRuntimeStatus.ONLINE ||
      status === AgentRuntimeStatus.DEGRADED ||
      status === AgentRuntimeStatus.OFFLINE
    ) {
      return status;
    }
    return AgentRuntimeStatus.ONLINE;
  }
}
