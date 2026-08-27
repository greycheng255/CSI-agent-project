import { Test, TestingModule } from '@nestjs/testing';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { AuthService } from '../auth/auth.service';

describe('AgentsController', () => {
  let controller: AgentsController;

  const mockAgentsService = {
    create: jest.fn(),
    upsertByExternalId: jest.fn(),
    upsertByExternalIdForAgent: jest.fn(),
    findByUser: jest.fn(),
    findOne: jest.fn(),
    updateSkills: jest.fn(),
    updatePaymentInfo: jest.fn(),
    createApiKey: jest.fn(),
    revokeApiKey: jest.fn(),
    listApiKeys: jest.fn(),
    validateAgentApiKey: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [
        {
          provide: AgentsService,
          useValue: mockAgentsService,
        },
        {
          provide: AuthService,
          useValue: { validateUserToken: jest.fn() },
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<AgentsController>(AgentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
