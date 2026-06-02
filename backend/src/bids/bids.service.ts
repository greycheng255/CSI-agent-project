import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bid } from './entities/bid.entity';
import { Task } from '../tasks/entities/task.entity';
import { Agent } from '../agents/entities/agent.entity';

type CreateBidDto = {
  taskId: string;
  agentId?: string;
  agentName?: string;
  priceCny: number;
  planSummary?: string;
  pricingModel?: string;
  pricingMeta?: Record<string, unknown>;
  expiresAt?: Date;
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
  ) {}

  async create(data: CreateBidDto) {
    // 1. 查找对应的 Task
    const task = await this.tasksRepository.findOne({
      where: { id: data.taskId },
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    // 2. 确定 Agent: 如果没传，就从数据库里随便抓一个真实的 Agent 来演示抢单
    let agent: Agent | null = null;
    if (data.agentId) {
      agent = await this.agentsRepository.findOne({
        where: { id: data.agentId },
      });
    } else {
      // 随机获取一个已注册的 Agent
      const agents = await this.agentsRepository.find({ take: 5 });
      if (agents.length > 0) {
        agent = agents[Math.floor(Math.random() * agents.length)];
      }
    }

    if (!agent) {
      // Create a mock agent for demonstration
      agent = this.agentsRepository.create({
        name:
          data.agentName || `AutoWorker-${Math.floor(Math.random() * 1000)}`,
        description: 'Auto-generated mock agent for bidding',
      });
      await this.agentsRepository.save(agent);
    }

    // 3. 检查是否已存在相同的 Agent + Task 的报价
    const existingBid = await this.bidsRepository.findOne({
      where: {
        task: { id: data.taskId },
        agent: { id: agent.id },
      },
    });

    // 4. 计算报价截止时间（默认24小时后）
    const expiresAt =
      data.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000);

    if (existingBid) {
      // 更新现有报价
      existingBid.priceCny = data.priceCny;
      existingBid.planSummary = data.planSummary || existingBid.planSummary;
      existingBid.pricingModel = data.pricingModel ?? existingBid.pricingModel;
      existingBid.pricingMeta = data.pricingMeta ?? existingBid.pricingMeta;
      existingBid.expiresAt = expiresAt;

      return this.bidsRepository.save(existingBid);
    }

    // 5. 创建新 Bid
    const bid = this.bidsRepository.create({
      task: task,
      agent: agent,
      priceCny: data.priceCny,
      planSummary: data.planSummary || 'I will complete this task efficiently.',
      pricingModel: data.pricingModel ?? null,
      pricingMeta: data.pricingMeta ?? null,
      expiresAt: expiresAt,
    });

    return this.bidsRepository.save(bid);
  }

  async findByTask(taskId: string) {
    return this.bidsRepository.find({
      where: { task: { id: taskId } },
      relations: ['agent'],
      order: { priceCny: 'ASC' }, // 默认按价格升序
    });
  }

  async findByAgent(agentId: string) {
    return this.bidsRepository.find({
      where: { agent: { id: agentId } },
      relations: ['agent', 'task'],
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  // 根据 bidId 更新报价
  async update(
    bidId: string,
    agentId: string,
    data: {
      priceCny: number;
      planSummary?: string;
      pricingModel?: string;
      pricingMeta?: Record<string, unknown>;
      expiresAt?: Date;
    },
  ) {
    // 查找报价
    const bid = await this.bidsRepository.findOne({
      where: { id: bidId },
      relations: ['agent'],
    });

    if (!bid) {
      throw new NotFoundException('Bid not found');
    }

    // 验证报价是否属于该 Agent
    if (bid.agent.id !== agentId) {
      throw new NotFoundException('Bid not found or not owned by this agent');
    }

    // 更新报价信息
    bid.priceCny = data.priceCny;
    if (data.planSummary !== undefined) {
      bid.planSummary = data.planSummary;
    }
    if (data.pricingModel !== undefined) {
      bid.pricingModel = data.pricingModel;
    }
    if (data.pricingMeta !== undefined) {
      bid.pricingMeta = data.pricingMeta;
    }
    if (data.expiresAt !== undefined) {
      bid.expiresAt = data.expiresAt;
    }

    return this.bidsRepository.save(bid);
  }

  // 根据 taskId 和 agentId 更新报价
  async updateByTask(
    taskId: string,
    agentId: string,
    data: {
      priceCny: number;
      planSummary?: string;
      pricingModel?: string;
      pricingMeta?: Record<string, unknown>;
      expiresAt?: Date;
    },
  ) {
    // 查找该 Agent 对该任务的报价
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

    // 更新报价信息
    bid.priceCny = data.priceCny;
    if (data.planSummary !== undefined) {
      bid.planSummary = data.planSummary;
    }
    if (data.pricingModel !== undefined) {
      bid.pricingModel = data.pricingModel;
    }
    if (data.pricingMeta !== undefined) {
      bid.pricingMeta = data.pricingMeta;
    }
    if (data.expiresAt !== undefined) {
      bid.expiresAt = data.expiresAt;
    }

    return this.bidsRepository.save(bid);
  }
}
