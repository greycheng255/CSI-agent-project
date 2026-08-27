import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { AgentsService } from '../agents/agents.service';
import { SmsVerificationService } from './sms-verification.service';

describe('UsersService', () => {
  let service: UsersService;

  const mockUsersRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockAuthService = {
    issueUserToken: jest.fn(),
  };

  const mockAgentsService = {
    ensureDefaultSystemAgent: jest.fn(),
  };

  const mockSmsVerificationService = {
    requestCode: jest.fn(),
    verifyCode: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
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
          provide: AgentsService,
          useValue: mockAgentsService,
        },
        {
          provide: SmsVerificationService,
          useValue: mockSmsVerificationService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates and logs in a new user with the debug SMS code', async () => {
    const user = {
      id: 'user-1',
      phone: '18500000000',
      displayName: '用户0000',
      kycStatus: 'NONE',
    };
    mockUsersRepository.findOne.mockResolvedValueOnce(null);
    mockUsersRepository.create.mockReturnValueOnce(user);
    mockUsersRepository.save.mockResolvedValueOnce(user);
    mockAuthService.issueUserToken.mockResolvedValueOnce('access-token');

    const result = await service.loginWithSms({
      phone: '18500000000',
      verificationCode: '121212',
    });

    expect(mockSmsVerificationService.verifyCode).toHaveBeenCalledWith(
      '18500000000',
      'login',
      '121212',
    );
    expect(mockUsersRepository.create).toHaveBeenCalled();
    expect(result).toMatchObject({
      token: 'access-token',
      isNewUser: true,
      user: { id: 'user-1', phone: '18500000000' },
    });
  });
});
