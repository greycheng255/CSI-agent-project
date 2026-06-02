import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TasksService } from './tasks.service';
import { Task } from './entities/task.entity';
import { Order } from '../orders/entities/order.entity';
import { Bid } from '../bids/entities/bid.entity';
import { Agent } from '../agents/entities/agent.entity';
import { User } from '../users/entities/user.entity';
import { WebhookDelivery } from '../webhooks/entities/webhook-delivery.entity';

describe('TasksService', () => {
  let service: TasksService;

  const mockTasksRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockOrdersRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };

  const mockBidsRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };

  const mockAgentsRepository = {
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: getRepositoryToken(Task),
          useValue: mockTasksRepository,
        },
        {
          provide: getRepositoryToken(Order),
          useValue: mockOrdersRepository,
        },
        {
          provide: getRepositoryToken(Bid),
          useValue: mockBidsRepository,
        },
        {
          provide: getRepositoryToken(Agent),
          useValue: mockAgentsRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUsersRepository,
        },
        {
          provide: getRepositoryToken(WebhookDelivery),
          useValue: mockWebhookDeliveriesRepository,
        },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
