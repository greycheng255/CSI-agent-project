import {
  Injectable,
  UnauthorizedException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, KycStatus } from './entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { AgentsService } from '../agents/agents.service';
import { WorkspacesService } from '../longtask/workspaces/workspaces.service';
import { hashSync, compareSync } from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import {
  SmsVerificationService,
  type SmsVerificationScene,
} from './sms-verification.service';

type AuthDto = {
  phone: string;
  password: string;
  displayName?: string;
};

type RegisterDto = {
  phone: string;
  password: string;
  verificationCode: string;
  displayName?: string;
};

type SmsLoginDto = {
  phone: string;
  verificationCode: string;
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private readonly authService: AuthService,
    @Inject(forwardRef(() => AgentsService))
    private readonly agentsService: AgentsService,
    @Inject(forwardRef(() => WorkspacesService))
    private readonly workspacesService: WorkspacesService,
    private readonly smsVerificationService: SmsVerificationService,
  ) {}

  private hashPassword(password: string): string {
    return hashSync(password, 10);
  }

  private verifyPassword(password: string, hash: string): boolean {
    return compareSync(password, hash);
  }

  /**
   * 用户注册
   * 所有用户统一为普通用户，不再区分雇主/开发者
   */
  async register(data: RegisterDto) {
    // 参数校验
    if (typeof data.phone !== 'string' || typeof data.password !== 'string') {
      throw new UnauthorizedException('手机号和密码不能为空');
    }

    // 手机号格式校验
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(data.phone)) {
      throw new UnauthorizedException('手机号格式不正确');
    }

    // 密码强度校验
    if (data.password.length < 6) {
      throw new UnauthorizedException('密码长度至少6位');
    }

    // 检查用户是否已存在
    const existingUser = await this.usersRepository.findOne({
      where: { phone: data.phone },
    });

    if (existingUser) {
      throw new UnauthorizedException('该手机号已注册');
    }

    this.smsVerificationService.verifyCode(
      data.phone,
      'register',
      data.verificationCode,
    );

    // 创建新用户：注册即分配计费 org（该账号为 owner）
    const user = this.usersRepository.create({
      phone: data.phone,
      passwordHash: this.hashPassword(data.password),
      displayName: data.displayName || `用户${data.phone.slice(-4)}`,
      kycStatus: KycStatus.NONE,
      orgId: randomUUID(),
    });

    await this.usersRepository.save(user);
    this.logger.log(`新用户注册成功: ${user.id} (${user.phone}) org=${user.orgId}`);

    await this.ensureDefaultAgent(user);

    return {
      message: '注册成功',
      user: {
        id: user.id,
        orgId: user.orgId,
        phone: user.phone,
        displayName: user.displayName,
      },
    };
  }

  /**
   * 用户登录
   * 所有用户统一处理，不再区分角色
   */
  async login(data: AuthDto) {
    if (typeof data.phone !== 'string' || typeof data.password !== 'string') {
      throw new UnauthorizedException('参数错误');
    }

    // 查找用户
    const user = await this.usersRepository.findOne({
      where: { phone: data.phone },
    });

    if (!user) {
      throw new UnauthorizedException('手机号未注册');
    } else {
      // 验证密码
      if (!this.verifyPassword(data.password, user.passwordHash)) {
        throw new UnauthorizedException('密码错误');
      }
    }

    // 签发令牌
    await this.ensureOrgId(user);
    const token = await this.authService.issueUserToken(user);
    await this.ensureDefaultAgent(user);
    await this.ensureDefaultWorkspace(user);

    return {
      message: '登录成功',
      token,
      user: {
        id: user.id,
        orgId: user.orgId,
        phone: user.phone,
        displayName: user.displayName,
        kycStatus: user.kycStatus,
      },
    };
  }

  /**
   * 确保账号已绑定计费 org。
   * 历史账号（org_id 列为空）首次登录/鉴权时惰性补分配，幂等。
   */
  async ensureOrgId(user: User): Promise<User> {
    if (!user.orgId) {
      user.orgId = randomUUID();
      await this.usersRepository.save(user);
      this.logger.log(`历史账号补分配 org: user=${user.id} org=${user.orgId}`);
    }
    return user;
  }

  async requestSmsCode(phone: string, scene: SmsVerificationScene) {
    return this.smsVerificationService.requestCode(phone, scene);
  }

  /**
   * 验证码登录。首次登录会自动创建用户，并使用不可猜测的随机密码占位。
   */
  async loginWithSms(data: SmsLoginDto) {
    if (
      typeof data.phone !== 'string' ||
      typeof data.verificationCode !== 'string'
    ) {
      throw new UnauthorizedException('手机号和验证码不能为空');
    }

    this.smsVerificationService.verifyCode(
      data.phone,
      'login',
      data.verificationCode,
    );

    let user = await this.usersRepository.findOne({
      where: { phone: data.phone },
    });
    let isNewUser = false;

    if (!user) {
      user = this.usersRepository.create({
        phone: data.phone,
        passwordHash: this.hashPassword(randomBytes(32).toString('hex')),
        displayName: `用户${data.phone.slice(-4)}`,
        kycStatus: KycStatus.NONE,
        orgId: randomUUID(),
      });
      await this.usersRepository.save(user);
      isNewUser = true;
      this.logger.log(`短信登录创建用户成功: ${user.id} org=${user.orgId}`);
    } else {
      await this.ensureOrgId(user);
    }

    const token = await this.authService.issueUserToken(user);
    await this.ensureDefaultAgent(user);
    await this.ensureDefaultWorkspace(user);

    return {
      message: isNewUser ? '登录并创建账号成功' : '登录成功',
      token,
      isNewUser,
      user: {
        id: user.id,
        orgId: user.orgId,
        phone: user.phone,
        displayName: user.displayName,
        kycStatus: user.kycStatus,
      },
    };
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(userId: string) {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    await this.ensureOrgId(user);

    return {
      id: user.id,
      orgId: user.orgId,
      phone: user.phone,
      email: user.email,
      displayName: user.displayName,
      kycStatus: user.kycStatus,
      createdAt: user.createdAt,
    };
  }

  /**
   * 更新用户信息
   */
  async updateUser(
    userId: string,
    data: { displayName?: string; email?: string },
  ) {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    if (data.displayName) {
      user.displayName = data.displayName;
    }
    if (data.email !== undefined) {
      user.email = data.email;
    }

    await this.usersRepository.save(user);

    return {
      message: '更新成功',
      user: {
        id: user.id,
        phone: user.phone,
        displayName: user.displayName,
      },
    };
  }

  /**
   * 修改用户密码
   */
  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    if (!this.verifyPassword(oldPassword, user.passwordHash)) {
      throw new UnauthorizedException('旧密码错误');
    }

    if (newPassword.length < 6) {
      throw new UnauthorizedException('新密码长度至少6位');
    }

    user.passwordHash = this.hashPassword(newPassword);
    await this.usersRepository.save(user);
  }

  private async ensureDefaultAgent(user: User) {
    try {
      await this.agentsService.ensureDefaultSystemAgent(user);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Default agent assignment failed: ${errorMessage}`);
    }
  }

  /**
   * 默认 Workspace 自动开通（PRD §4.1 step 3）：注册/登录后自动初始化默认工作室。
   * 幂等（已有则跳过）；失败仅告警不阻断注册/登录主流程。
   */
  private async ensureDefaultWorkspace(user: User) {
    try {
      const { created, workspace } =
        await this.workspacesService.ensureDefaultForOwner({
          ownerUserId: user.id,
          orgId: user.orgId,
          displayName: user.displayName,
        });
      if (created) {
        this.logger.log(
          `默认工作室自动开通: user=${user.id} workspace=${workspace.id} slug=${workspace.slug}`,
        );
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Default workspace auto-create skipped: ${errorMessage}`);
    }
  }
}
