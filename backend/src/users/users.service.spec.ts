import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { AgentsService } from '../agents/agents.service';
import { WorkspacesService } from '../longtask/workspaces/workspaces.service';
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

  const mockWorkspacesService = {
    ensureDefaultForOwner: jest
      .fn()
      .mockResolvedValue({ created: false, workspace: null }),
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
          provide: WorkspacesService,
          useValue: mockWorkspacesService,
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

  it('新用户注册/短信登录后自动开通默认 Workspace（PRD §4.1 step 3）', async () => {
    const user = {
      id: 'user-2',
      phone: '18500000002',
      displayName: '用户0002',
      orgId: 'org-2',
      kycStatus: 'NONE',
    };
    mockUsersRepository.findOne.mockResolvedValueOnce(null);
    mockUsersRepository.create.mockReturnValueOnce(user);
    mockUsersRepository.save.mockResolvedValueOnce(user);
    mockAuthService.issueUserToken.mockResolvedValueOnce('access-token');
    mockWorkspacesService.ensureDefaultForOwner.mockResolvedValueOnce({
      created: true,
      workspace: { id: 'ws-2', slug: 'ai-ws-user-2' },
    });

    await service.loginWithSms({
      phone: '18500000002',
      verificationCode: '121212',
    });

    expect(mockWorkspacesService.ensureDefaultForOwner).toHaveBeenCalledWith({
      ownerUserId: 'user-2',
      orgId: 'org-2',
      displayName: '用户0002',
    });
  });

  it('默认工作室开通失败不阻断登录主流程', async () => {
    const user = {
      id: 'user-3',
      phone: '18500000003',
      displayName: '用户0003',
      orgId: 'org-3',
      kycStatus: 'NONE',
    };
    mockUsersRepository.findOne.mockResolvedValueOnce(null);
    mockUsersRepository.create.mockReturnValueOnce(user);
    mockUsersRepository.save.mockResolvedValueOnce(user);
    mockAuthService.issueUserToken.mockResolvedValueOnce('access-token');
    mockWorkspacesService.ensureDefaultForOwner.mockRejectedValueOnce(
      new Error('db down'),
    );

    const result = await service.loginWithSms({
      phone: '18500000003',
      verificationCode: '121212',
    });
    expect(result.token).toBe('access-token');
  });
});
