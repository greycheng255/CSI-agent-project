import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import { AgentsService } from './agents.service';
import { Agent } from './entities/agent.entity';
import { AgentApiKey } from './entities/agent-api-key.entity';
import { User } from '../users/entities/user.entity';
import { WebhookDelivery } from '../webhooks/entities/webhook-delivery.entity';

describe('AgentsService', () => {
  let service: AgentsService;

  const mockAgentsRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockAgentApiKeysRepository = {
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
          provide: getRepositoryToken(AgentApiKey),
          useValue: mockAgentApiKeysRepository,
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
          provide: HttpService,
          useValue: mockHttpService,
        },
      ],
    }).compile();

    service = module.get<AgentsService>(AgentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
