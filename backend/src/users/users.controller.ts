import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { SmsVerificationScene } from './sms-verification.service';

/**
 * 注册请求DTO
 */
interface RegisterDto {
  phone: string;
  password: string;
  verificationCode: string;
  displayName?: string;
}

/**
 * 登录请求DTO
 */
interface LoginDto {
  phone: string;
  password: string;
}

interface SmsLoginDto {
  phone: string;
  verificationCode: string;
}

/**
 * 更新用户信息DTO
 */
interface UpdateUserDto {
  displayName?: string;
  email?: string;
}

/**
 * 用户控制器
 * 处理用户注册、登录、信息管理等
 */
@Controller('api/v1/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  /**
   * 用户注册
   * POST /api/v1/users/register
   */
  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.usersService.register(body);
  }

  /**
   * 用户登录
   * POST /api/v1/users/login
   */
  @Post('login')
  login(@Body() body: LoginDto) {
    return this.usersService.login(body);
  }

  /**
   * 发送登录或注册短信验证码
   * POST /api/v1/users/sms-code
   */
  @Post('sms-code')
  requestSmsCode(@Body() body: { phone: string; scene: SmsVerificationScene }) {
    return this.usersService.requestSmsCode(body.phone, body.scene);
  }

  /**
   * 短信验证码登录；手机号未注册时自动创建账号
   * POST /api/v1/users/login/sms
   */
  @Post('login/sms')
  loginWithSms(@Body() body: SmsLoginDto) {
    return this.usersService.loginWithSms(body);
  }

  /**
   * 获取当前用户信息
   * GET /api/v1/users/me
   * 需要登录
   */
  @Get('me')
  @UseGuards(AuthGuard)
  getCurrentUser(@Req() req: RequestWithUser) {
    return this.usersService.getUserInfo(req.user.id);
  }

  /**
   * 更新当前用户信息
   * POST /api/v1/users/me
   * 需要登录
   */
  @Post('me')
  @UseGuards(AuthGuard)
  updateCurrentUser(@Req() req: RequestWithUser, @Body() body: UpdateUserDto) {
    return this.usersService.updateUser(req.user.id, body);
  }

  /**
   * 修改密码
   * POST /api/v1/users/change-password
   */
  @Post('change-password')
  @UseGuards(AuthGuard)
  async changePassword(
    @Req() req: RequestWithUser,
    @Body() body: { oldPassword: string; newPassword: string },
  ) {
    await this.usersService.changePassword(
      req.user.id,
      body.oldPassword,
      body.newPassword,
    );
    return { message: '密码修改成功' };
  }

  /**
   * 用户登出：撤销当前 Bearer 令牌（服务端立即失效）
   * POST /api/v1/users/logout
   */
  @Post('logout')
  @UseGuards(AuthGuard)
  async logout(@Req() req: RequestWithUser) {
    if (req.token) {
      await this.authService.revokeToken(req.token);
    }
    return { message: '已退出登录' };
  }

  /**
   * 创建个人访问令牌（PAT），token 仅本次返回
   * POST /api/v1/users/pat
   */
  @Post('pat')
  @UseGuards(AuthGuard)
  async createPat(
    @Req() req: RequestWithUser,
    @Body() body: { name: string; expiresInDays?: number },
  ) {
    if (!body.name || typeof body.name !== 'string') {
      throw new BadRequestException('令牌名称不能为空');
    }
    let expiresInDays: number | undefined;
    if (body.expiresInDays !== undefined && body.expiresInDays !== null) {
      expiresInDays = Number(body.expiresInDays);
      if (!Number.isFinite(expiresInDays) || expiresInDays <= 0) {
        throw new BadRequestException('有效期必须为正整数天数');
      }
    }
    const { token, expiresAt } = await this.authService.issuePersonalAccessToken(
      req.user,
      body.name.trim().slice(0, 64),
      expiresInDays,
    );
    return {
      message: '创建成功，请立即复制保存，令牌仅显示一次',
      token,
      pat: {
        name: body.name.trim().slice(0, 64),
        expiresAt,
      },
    };
  }

  /**
   * 当前用户的 PAT 列表（不含 token 值）
   * GET /api/v1/users/pat
   */
  @Get('pat')
  @UseGuards(AuthGuard)
  async listPats(@Req() req: RequestWithUser) {
    const pats = await this.authService.listPersonalAccessTokens(req.user.id);
    return {
      pats: pats.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        lastUsedAt: row.lastUsedAt,
        revokedAt: row.revokedAt,
      })),
    };
  }

  /**
   * 撤销 PAT
   * DELETE /api/v1/users/pat/:id
   */
  @Delete('pat/:id')
  @UseGuards(AuthGuard)
  async revokePat(@Req() req: RequestWithUser, @Param('id') id: string) {
    const ok = await this.authService.revokePersonalAccessToken(req.user.id, id);
    if (!ok) {
      throw new NotFoundException('令牌不存在或已撤销');
    }
    return { message: '已撤销' };
  }
}
