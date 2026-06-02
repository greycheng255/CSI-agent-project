import {
  Injectable,
  UnauthorizedException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, KycStatus, UserRole } from './entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { AgentManagerService } from '../agents/agent-manager.service';
import { createHash } from 'crypto';

type AuthDto = {
  phone: string;
  password: string;
  displayName?: string;
};

type RegisterDto = {
  phone: string;
  password: string;
  displayName?: string;
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private readonly authService: AuthService,
    @Inject(forwardRef(() => AgentManagerService))
    private readonly agentManagerService: AgentManagerService,
  ) {}

  private hashPassword(password: string): string {
    return createHash('sha256').update(password).digest('hex');
  }

  /**
   * 用户注册
   * 所有新注册用户默认为 CLIENT 角色
   * 13800000001 不再是管理员，只是一个普通用户
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

    // 创建新用户 - 所有用户默认为 CLIENT 角色
    const user = this.usersRepository.create({
      phone: data.phone,
      passwordHash: this.hashPassword(data.password),
      displayName: data.displayName || `用户${data.phone.slice(-4)}`,
      kycStatus: KycStatus.NONE,
      role: UserRole.CLIENT, // 所有新用户都是普通用户
    });

    await this.usersRepository.save(user);
    this.logger.log(`新用户注册成功: ${user.id} (${user.phone})`);

    // 为新用户自动创建 Agent
    if (this.agentManagerService) {
      try {
        this.logger.log(`为新用户 ${user.id} 自动创建 Agent`);
        const ownerToken = await this.authService.issueUserToken(user);
        const agent = await this.agentManagerService.createAgentForUser(
          user,
          ownerToken,
        );
        this.logger.log(`Agent 创建成功: ${agent.id}`);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Agent 创建失败: ${errorMessage}`);
      }
    }

    return {
      message: '注册成功',
      user: {
        id: user.id,
        phone: user.phone,
        displayName: user.displayName,
        role: user.role,
      },
    };
  }

  /**
   * 用户登录
   * 不再根据手机号自动分配角色，所有用户都是 CLIENT
   * 13900000002 作为 Agent 主人，也是 CLIENT 角色，但拥有 Agent
   */
  async login(data: AuthDto) {
    if (typeof data.phone !== 'string' || typeof data.password !== 'string') {
      throw new UnauthorizedException('参数错误');
    }

    // 查找用户
    let user = await this.usersRepository.findOne({
      where: { phone: data.phone },
    });

    // 如果用户不存在，自动创建（方便测试）
    if (!user) {
      user = this.usersRepository.create({
        phone: data.phone,
        passwordHash: this.hashPassword(data.password),
        displayName: `用户${data.phone.slice(-4)}`,
        kycStatus: KycStatus.NONE,
        role: UserRole.CLIENT, // 所有用户都是 CLIENT
      });
      await this.usersRepository.save(user);
      this.logger.log(`自动创建用户: ${user.id} (${user.phone})`);

      // 为新用户自动创建 Agent
      if (this.agentManagerService) {
        try {
          const ownerToken = await this.authService.issueUserToken(user);
          await this.agentManagerService.createAgentForUser(user, ownerToken);
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(`Agent 创建失败: ${errorMessage}`);
        }
      }
    } else {
      // 验证密码
      const passwordHash = this.hashPassword(data.password);
      if (user.passwordHash !== passwordHash) {
        throw new UnauthorizedException('密码错误');
      }
    }

    // 签发令牌
    const token = await this.authService.issueUserToken(user);

    return {
      message: '登录成功',
      token,
      user: {
        id: user.id,
        phone: user.phone,
        displayName: user.displayName,
        kycStatus: user.kycStatus,
        role: user.role,
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

    return {
      id: user.id,
      phone: user.phone,
      displayName: user.displayName,
      kycStatus: user.kycStatus,
      role: user.role,
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

    await this.usersRepository.save(user);

    return {
      message: '更新成功',
      user: {
        id: user.id,
        phone: user.phone,
        displayName: user.displayName,
        role: user.role,
      },
    };
  }
}
