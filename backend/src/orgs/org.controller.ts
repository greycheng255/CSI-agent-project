import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { OrgService } from './org.service';

/**
 * 统一账户体系 Org 解析 API。
 *
 * 定位：OIDC 登录态 org_id claim 的「解析 API 兜底」
 * （claim 首选；Console / 计费侧拿不到 claim 时由此解析）。
 *
 * - GET /api/v1/orgs/me         当前登录账号的 org（自助）
 * - GET /api/v1/orgs/resolve     按 user_id 解析（管理员兜底）
 */
@Controller('api/v1/orgs')
export class OrgController {
  constructor(private readonly orgService: OrgService) {}

  /** 当前登录账号的 org（OIDC claim 兜底：自助解析） */
  @Get('me')
  @UseGuards(AuthGuard)
  async getMyOrg(@Req() req: RequestWithUser) {
    const org = await this.orgService.resolveByUserId(req.user.id);
    if (!org) {
      throw new NotFoundException('当前账号尚未绑定 org');
    }
    return {
      org_id: org.id,
      slug: org.slug,
      name: org.name,
      owner_user_id: org.ownerUserId,
      created_at: org.createdAt,
    };
  }

  /**
   * 按 user_id 解析 org（管理员兜底）。
   * Console / 计费侧在拿不到 OIDC claim 时使用。
   */
  @Get('resolve')
  @UseGuards(AdminGuard)
  async resolveByUser(@Query('user_id') userId?: string) {
    if (!userId || typeof userId !== 'string') {
      throw new BadRequestException('缺少 user_id 参数');
    }
    const org = await this.orgService.resolveByUserId(userId);
    if (!org) {
      throw new NotFoundException('该账号尚未绑定 org');
    }
    return {
      org_id: org.id,
      slug: org.slug,
      name: org.name,
      owner_user_id: org.ownerUserId,
      user_id: userId,
      created_at: org.createdAt,
    };
  }
}
