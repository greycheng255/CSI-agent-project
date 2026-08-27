import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Bid, BidStatus } from './entities/bid.entity';
import { Task, TaskStatus } from '../tasks/entities/task.entity';
import {
  Agent,
  AgentApprovalStatus,
  AgentRuntimeStatus,
} from '../agents/entities/agent.entity';
import { BidsRankingService } from './bids-ranking.service';

type CreateBidDto = {
  taskId: string;
  agentId?: string;
  agentName?: string;
  priceCny: number;
  planSummary?: string;
  pricingModel?: string;
  pricingMeta?: Record<string, unknown>;
  expiresAt?: Date;
  confidenceScore?: number;
  estimatedHours?: number;
  riskNotes?: string;
};

type UpdateBidDto = {
  priceCny: number;
  planSummary?: string;
  pricingModel?: string;
  pricingMeta?: Record<string, unknown>;
  expiresAt?: Date;
  confidenceScore?: number;
  estimatedHours?: number;
  riskNotes?: string;
};

@Injectable()
export class BidsService {
  constructor(
    @InjectRepository(Bid)
    private bidsRepository: Repository<Bid>,
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
    @InjectRepository(Agent)
    private agentsRepository: Repository<Agent>,
    private bidsRankingService: BidsRankingService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireSubmittedBids() {
    const expired = await this.bidsRepository.find({
      where: {
        status: BidStatus.SUBMITTED,
        expiresAt: LessThan(new Date()),
      },
    });
    for (const bid of expired) {
      bid.status = BidStatus.EXPIRED;
      await this.bidsRepository.save(bid);
    }
    return expired.length;
  }

  private assertAgentCanBid(agent: Agent) {
    if (agent.approvalStatus !== AgentApprovalStatus.APPROVED || agent.isActive === false) {
      throw new BadRequestException('Agent is not approved or active');
    }
    if (
      agent.runtimeStatus !== AgentRuntimeStatus.ONLINE &&
      agent.runtimeStatus !== AgentRuntimeStatus.DEGRADED
    ) {
      throw new BadRequestException('Agent is not online or degraded');
    }
  }

  private applyBidFields(bid: Bid, data: UpdateBidDto) {
    bid.priceCny = data.priceCny;
    if (data.planSummary !== undefined) bid.planSummary = data.planSummary;
    if (data.pricingModel !== undefined) bid.pricingModel = data.pricingModel;
    if (data.pricingMeta !== undefined) bid.pricingMeta = data.pricingMeta;
    if (data.expiresAt !== undefined) bid.expiresAt = data.expiresAt;
    if (data.confidenceScore !== undefined) {
      bid.confidenceScore = Math.max(0, Math.min(1, data.confidenceScore));
    }
    if (data.estimatedHours !== undefined) bid.estimatedHours = data.estimatedHours;
    if (data.riskNotes !== undefined) bid.riskNotes = data.riskNotes;
  }

  async create(data: CreateBidDto) {
    const task = await this.tasksRepository.findOne({
      where: { id: data.taskId },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.status !== TaskStatus.OPEN) {
      throw new BadRequestException('Task is not open for bidding');
    }
    if (!data.agentId) {
      throw new BadRequestException('agentId is required');
    }

    const agent = await this.agentsRepository.findOne({
      where: { id: data.agentId },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    this.assertAgentCanBid(agent);

    const expiresAt =
      data.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000);

    const existingBid = await this.bidsRepository.findOne({
      where: {
        task: { id: data.taskId },
        agent: { id: agent.id },
      },
      relations: ['task', 'agent'],
    });

    if (existingBid) {
      if (
        existingBid.status !== BidStatus.SUBMITTED &&
        existingBid.status !== BidStatus.WITHDRAWN
      ) {
        throw new BadRequestException('Bid cannot be resubmitted in current status');
      }
      this.applyBidFields(existingBid, { ...data, expiresAt });
      existingBid.status = BidStatus.SUBMITTED;
      return this.bidsRepository.save(existingBid);
    }

    const bid = this.bidsRepository.create({
      task,
      agent,
      priceCny: data.priceCny,
      planSummary: data.planSummary || 'I will complete this task efficiently.',
      pricingModel: data.pricingModel ?? null,
      pricingMeta: data.pricingMeta ?? null,
      expiresAt,
      status: BidStatus.SUBMITTED,
      confidenceScore: Math.max(0, Math.min(1, data.confidenceScore ?? 0.5)),
      estimatedHours: data.estimatedHours ?? null,
      riskNotes: data.riskNotes ?? null,
    });

    return this.bidsRepository.save(bid);
  }

  async findByTask(taskId: string) {
    const bids = await this.bidsRepository.find({
      where: { task: { id: taskId } },
      relations: ['agent', 'agent.owner', 'task'],
    });
    return this.bidsRankingService.rank(bids);
  }

  async findByAgent(agentId: string) {
    return this.bidsRepository.find({
      where: { agent: { id: agentId } },
      relations: ['agent', 'task'],
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async update(bidId: string, agentId: string, data: UpdateBidDto) {
    const bid = await this.bidsRepository.findOne({
      where: { id: bidId },
      relations: ['agent'],
    });
    if (!bid || bid.agent.id !== agentId) {
      throw new NotFoundException('Bid not found or not owned by this agent');
    }
    if (bid.status !== BidStatus.SUBMITTED) {
      throw new BadRequestException('Only submitted bids can be updated');
    }

    this.applyBidFields(bid, data);
    return this.bidsRepository.save(bid);
  }

  async withdraw(bidId: string, agentId: string) {
    const bid = await this.bidsRepository.findOne({
      where: { id: bidId },
      relations: ['agent'],
    });
    if (!bid || bid.agent.id !== agentId) {
      throw new NotFoundException('Bid not found or not owned by this agent');
    }
    if (bid.status !== BidStatus.SUBMITTED) {
      throw new BadRequestException('Only submitted bids can be withdrawn');
    }
    bid.status = BidStatus.WITHDRAWN;
    return this.bidsRepository.save(bid);
  }

  async updateByTask(taskId: string, agentId: string, data: UpdateBidDto) {
    const bid = await this.bidsRepository.findOne({
      where: {
        task: { id: taskId },
        agent: { id: agentId },
      },
      relations: ['agent', 'task'],
    });
    if (!bid) {
      throw new NotFoundException('Bid not found for this task and agent');
    }
    return this.update(bid.id, agentId, data);
  }
}
