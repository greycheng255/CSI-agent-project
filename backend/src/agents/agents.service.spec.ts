import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import { AgentsService } from './agents.service';
import { Agent } from './entities/agent.entity';
import { AgentCredential } from './entities/agent-credential.entity';
import { User } from '../users/entities/user.entity';
import { WebhookDelivery } from '../webhooks/entities/webhook-delivery.entity';
import { AgentAuditLog } from './entities/agent-audit-log.entity';
import { AgentCardService } from './agent-card.service';
import { AgentsHealthService } from './agents-health.service';

describe('AgentsService', () => {
  let service: AgentsService;

  const mockAgentsRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockAgentCredentialsRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };

  const mockUsersRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };

  const mockWebhookDeliveriesRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockAgentAuditLogsRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockHttpService = {
    get: jest.fn(),
    post: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsService,
        {
          provide: getRepositoryToken(Agent),
          useValue: mockAgentsRepository,
        },
        {
          provide: getRepositoryToken(AgentCredential),
          useValue: mockAgentCredentialsRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUsersRepository,
        },
        {
          provide: getRepositoryToken(WebhookDelivery),
          useValue: mockWebhookDeliveriesRepository,
        },
        {
          provide: getRepositoryToken(AgentAuditLog),
          useValue: mockAgentAuditLogsRepository,
        },
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
        {
          provide: AgentCardService,
          useValue: { upsertCard: jest.fn(), findActiveCard: jest.fn() },
        },
        {
          provide: AgentsHealthService,
          useValue: { recordHeartbeat: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AgentsService>(AgentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
