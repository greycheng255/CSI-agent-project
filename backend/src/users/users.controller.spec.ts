import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { AuthGuard } from '../auth/auth.guard';
import { CasdoorSsoService } from './casdoor-sso.service';

describe('UsersController', () => {
  let controller: UsersController;

  const mockUsersService = {
    register: jest.fn(),
    login: jest.fn(),
    requestSmsCode: jest.fn(),
    loginWithSms: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
  };

  const mockAuthService = { validateUser: jest.fn() };

  const mockCasdoorSso = {
    isConfigured: jest.fn().mockReturnValue(true),
    resolveRedirectUri: jest.fn((uri: string) => uri),
    buildAuthorizeUrl: jest.fn(
      (uri: string, state: string) => `http://casdoor.test/authorize?state=${state}`,
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: CasdoorSsoService,
          useValue: mockCasdoorSso,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
