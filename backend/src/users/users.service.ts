import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
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
import { CasdoorSyncService } from './casdoor-sync.service';
import { CasdoorSsoService } from './casdoor-sso.service';
import { encryptIdCard, maskIdCard } from './kyc-crypto';

/** 18 位身份证校验位验证（GB 11643-1999 加权算法） */
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
function isValidIdCard(id: string): boolean {
  const v = (id ?? '').trim().toUpperCase();
  if (!/^\d{17}[\dX]$/.test(v)) return false;
  const sum = ID_WEIGHTS.reduce((acc, w, i) => acc + w * Number(v[i]), 0);
  return ID_CHECK_CODES[sum % 11] === v[17];
}

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
    private readonly casdoorSync: CasdoorSyncService,
    private readonly casdoorSso: CasdoorSsoService,
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
    // 同步真实密码至 Casdoor，保证 SSO 与平台密码一致
    await this.casdoorSync.syncUser(user, data.password);

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
      await this.casdoorSync.syncUser(user);
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
   * Casdoor SSO 登录（OIDC 授权码）。
   * 验签通过后按 properties.genesis_user_id 关联平台用户（兜底 name=手机号）。
   * Casdoor 账号均由平台同步产生；未找到关联用户视为数据不一致，拒绝并提示走短信登录。
   */
  async loginWithSso(data: { code: string; redirectUri: string }) {
    if (
      typeof data?.code !== 'string' ||
      typeof data?.redirectUri !== 'string' ||
      !data.code ||
      !data.redirectUri
    ) {
      throw new UnauthorizedException('code 与 redirectUri 不能为空');
    }
    if (!this.casdoorSso.isConfigured()) {
      throw new UnauthorizedException('SSO 未配置（缺少 CASDOOR_* 环境变量）');
    }

    const redirectUri = this.casdoorSso.resolveRedirectUri(data.redirectUri);
    const { claims, platformUserId, phone } =
      await this.casdoorSso.resolvePlatformIdentity(data.code, redirectUri);

    let user: User | null = null;
    if (platformUserId) {
      user = await this.usersRepository.findOne({
        where: { id: platformUserId },
      });
    }
    if (!user && phone) {
      user = await this.usersRepository.findOne({ where: { phone } });
    }
    if (!user) {
      this.logger.warn(
        `SSO 登录拒绝: casdoor sub=${claims.sub} 未关联平台用户 (genesis_user_id=${platformUserId ?? '无'} phone=${phone ?? '无'})`,
      );
      throw new UnauthorizedException(
        '该 Casdoor 账号未关联平台用户，请使用短信验证码登录',
      );
    }

    this.logger.log(
      `SSO 登录成功: user=${user.id} phone=${user.phone} casdoor_sub=${claims.sub}`,
    );
    const token = await this.authService.issueUserToken(user, {
      name: `sso:${claims.sub.slice(0, 8)}`,
      clientId: 'casdoor',
    });
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
      wechatBound: !!user.wechatOpenid,
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
   * 提交实名认证（持久化）：姓名 + 身份证号（AES-256-GCM 加密落库），通过后 kycStatus=VERIFIED。
   * 幂等：已 VERIFIED 直接返回。提交即通过为公测简化口径，接入三方核身后改为 PENDING。
   */
  async submitKyc(
    userId: string,
    realName: string,
    idCardNumber: string,
  ) {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
    });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    if (user.kycStatus === KycStatus.VERIFIED) {
      return {
        message: '已通过实名认证',
        user: {
          id: user.id,
          phone: user.phone,
          displayName: user.displayName,
          kycStatus: user.kycStatus,
        },
      };
    }

    const name = (realName ?? '').trim();
    if (name.length < 2 || name.length > 30) {
      throw new BadRequestException('请输入真实的姓名（2-30 个字符）');
    }
    if (!isValidIdCard(idCardNumber ?? '')) {
      throw new BadRequestException('身份证号格式不正确');
    }

    user.idCardName = name;
    user.idCardNumberCipher = encryptIdCard((idCardNumber ?? '').trim().toUpperCase());
    user.kycStatus = KycStatus.VERIFIED;
    await this.usersRepository.save(user);

    this.logger.log(`KYC 提交成功: user=${user.id}`);

    return {
      message: '实名认证已通过',
      user: {
        id: user.id,
        phone: user.phone,
        displayName: user.displayName,
        kycStatus: user.kycStatus,
        idCardMasked: maskIdCard(idCardNumber.trim()),
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
    // 改密后同步 Casdoor（SSO 口径一致）；失败仅告警不阻断
    await this.casdoorSync.syncPasswordHash(user);
  }

  /**
   * 短信验证码设置密码（供短信登录自动建号用户打通 SSO）。
   * 短信建号用户无平台密码，无法走 changePassword 改密链路；
   * 该接口以短信验证码（login 场景）验证本人身份后直接设置平台密码，并同步 Casdoor。
   */
  async setPasswordBySms(data: {
    userId: string;
    verificationCode: string;
    newPassword: string;
  }): Promise<void> {
    const { userId, verificationCode, newPassword } = data;
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    if (!user.phone) {
      throw new UnauthorizedException('该账号未绑定手机号，无法使用短信验证码设置密码');
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      throw new UnauthorizedException('新密码长度至少6位');
    }
    // 以验证码验证本人身份（与本机短信登录同一场景）
    this.smsVerificationService.verifyCode(user.phone, 'login', verificationCode);

    user.passwordHash = this.hashPassword(newPassword);
    await this.usersRepository.save(user);
    // 同步 Casdoor 密码，使该账号可用新密码走 SSO
    await this.casdoorSync.syncPasswordHash(user);
    this.logger.log(`短信验证码设置密码成功并同步Casdoor: user=${user.id}`);
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
