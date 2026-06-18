import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';

/**
 * 注册请求DTO
 */
interface RegisterDto {
  phone: string;
  password: string;
  displayName?: string;
}

/**
 * 登录请求DTO
 */
interface LoginDto {
  phone: string;
  password: string;
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
  constructor(private readonly usersService: UsersService) {}

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
}
