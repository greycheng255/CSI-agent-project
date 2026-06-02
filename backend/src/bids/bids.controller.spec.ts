import { Test, TestingModule } from '@nestjs/testing';
import { BidsController } from './bids.controller';
import { BidsService } from './bids.service';
import { AgentsService } from '../agents/agents.service';

describe('BidsController', () => {
  let controller: BidsController;

  const mockBidsService = {
    create: jest.fn(),
    findByTask: jest.fn(),
    findByAgent: jest.fn(),
  };

  const mockAgentsService = {
    validateAgentApiKey: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BidsController],
      providers: [
        {
          provide: BidsService,
          useValue: mockBidsService,
        },
        {
          provide: AgentsService,
          useValue: mockAgentsService,
        },
      ],
    }).compile();

    controller = module.get<BidsController>(BidsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
