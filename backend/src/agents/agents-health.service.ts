import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Agent,
  AgentApprovalStatus,
  AgentRuntimeStatus,
  AgentStatus,
} from './entities/agent.entity';
import { AgentHeartbeat } from './entities/agent-heartbeat.entity';
import { AgentAuditLog } from './entities/agent-audit-log.entity';

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
    @InjectRepository(AgentAuditLog)
    private readonly auditLogsRepository: Repository<AgentAuditLog>,
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
    const agents = await this.agentsRepository.find({
      where: {
        approvalStatus: AgentApprovalStatus.APPROVED,
        isActive: true,
      },
    });

    let changed = 0;
    for (const agent of agents) {
      const previousRuntimeStatus = agent.runtimeStatus;
      const previousStatus = agent.status;
      const nextRuntimeStatus = this.calculateRuntimeStatus(
        agent.lastHeartbeatAt,
        now,
      );
      const nextStatus =
        nextRuntimeStatus === AgentRuntimeStatus.OFFLINE
          ? AgentStatus.OFFLINE
          : AgentStatus.ONLINE;

      if (
        previousRuntimeStatus === nextRuntimeStatus &&
        previousStatus === nextStatus
      ) {
        continue;
      }

      agent.runtimeStatus = nextRuntimeStatus;
      agent.status = nextStatus;
      await this.agentsRepository.save(agent);
      await this.auditLogsRepository.save(
        this.auditLogsRepository.create({
          agent,
          actor: null,
          action: `runtime_${nextRuntimeStatus}`,
          beforeValue: {
            runtimeStatus: previousRuntimeStatus,
            status: previousStatus,
          },
          afterValue: {
            runtimeStatus: nextRuntimeStatus,
            status: nextStatus,
          },
        }),
      );
      changed += 1;
    }

    return changed;
  }

  calculateRuntimeStatus(lastHeartbeatAt: Date | null, now = Date.now()) {
    if (!lastHeartbeatAt) return AgentRuntimeStatus.OFFLINE;
    const ageMs = now - lastHeartbeatAt.getTime();
    if (ageMs <= this.degradedMs) return AgentRuntimeStatus.ONLINE;
    if (ageMs <= this.offlineMs) return AgentRuntimeStatus.DEGRADED;
    return AgentRuntimeStatus.OFFLINE;
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
