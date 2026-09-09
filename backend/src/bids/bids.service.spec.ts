import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { BidsService } from './bids.service';
import { Bid, BidStatus } from './entities/bid.entity';
import { Task, TaskStatus } from '../tasks/entities/task.entity';
import {
  Agent,
  AgentApprovalStatus,
  AgentRuntimeStatus,
} from '../agents/entities/agent.entity';
import { BidsRankingService } from './bids-ranking.service';

describe('BidsService', () => {
  let service: BidsService;

  const mockBidsRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockTasksRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };

  const mockAgentsRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidsService,
        {
          provide: getRepositoryToken(Bid),
          useValue: mockBidsRepository,
        },
        {
          provide: getRepositoryToken(Task),
          useValue: mockTasksRepository,
        },
        {
          provide: getRepositoryToken(Agent),
          useValue: mockAgentsRepository,
        },
        {
          provide: BidsRankingService,
          useValue: { rank: jest.fn((bids) => bids) },
        },
      ],
    }).compile();

    service = module.get<BidsService>(BidsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createByOwner（Owner 手动让名下 agent 报价）', () => {
    const ownerAgent = {
      id: 'agent-1',
      approvalStatus: AgentApprovalStatus.APPROVED,
      isActive: true,
      runtimeStatus: AgentRuntimeStatus.OFFLINE,
      owner: { id: 'owner-A' },
    } as unknown as Agent;

    const openTask = {
      id: 'task-1',
      status: TaskStatus.OPEN,
    } as Task;

    beforeEach(() => {
      mockAgentsRepository.findOne
        .mockResolvedValueOnce(ownerAgent) // createByOwner 归属查询
        .mockResolvedValueOnce(ownerAgent); // create() 内断言查询
      mockTasksRepository.findOne.mockResolvedValueOnce(openTask);
      mockBidsRepository.findOne.mockResolvedValueOnce(null);
      mockBidsRepository.create.mockImplementation((v) => v);
      mockBidsRepository.save.mockImplementation((v) => ({
        ...v,
        id: 'bid-1',
        status: BidStatus.SUBMITTED,
      }));
    });

    it('名下 agent 报价成功（允许离线：手动显式意图）', async () => {
      const result = await service.createByOwner('owner-A', {
        taskId: 'task-1',
        agentId: 'agent-1',
        priceCny: 1000,
      });
      expect(result.id).toBe('bid-1');
      expect(mockAgentsRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'agent-1' },
        relations: ['owner'],
      });
    });

    it('agent 不属于该 owner → 拒绝', async () => {
      mockAgentsRepository.findOne.mockReset();
      mockAgentsRepository.findOne.mockResolvedValueOnce({
        ...ownerAgent,
        owner: { id: 'owner-OTHER' },
      });
      await expect(
        service.createByOwner('owner-A', {
          taskId: 'task-1',
          agentId: 'agent-1',
          priceCny: 1000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('agent 未审核/未启用 → 拒绝（即使 manual 也不放行）', async () => {
      mockAgentsRepository.findOne.mockReset();
      mockAgentsRepository.findOne.mockResolvedValue({
        ...ownerAgent,
        owner: { id: 'owner-A' },
        approvalStatus: AgentApprovalStatus.PENDING_REVIEW,
      });
      await expect(
        service.createByOwner('owner-A', {
          taskId: 'task-1',
          agentId: 'agent-1',
          priceCny: 1000,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
