import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { AgentManagerService } from '../agents/agent-manager.service';

describe('UsersService', () => {
  let service: UsersService;

  const mockUsersRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockAuthService = {
    generateTokens: jest.fn(),
  };

  const mockAgentManagerService = {
    getDefaultAgent: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUsersRepository,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: AgentManagerService,
          useValue: mockAgentManagerService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
