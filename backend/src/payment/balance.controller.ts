import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { BalanceService } from './balance.service';
import { RechargeService } from './recharge.service';
import {
  UserOrAdminGuard,
  type RequestWithUserOrAdmin,
} from '../auth/user-or-admin.guard';
import { AdminGuard } from '../admin/admin.guard';

@Controller('api/v1/balance')
@UseGuards(UserOrAdminGuard)
export class BalanceController {
  constructor(
    private readonly balanceService: BalanceService,
    private readonly rechargeService: RechargeService,
  ) {}

  /**
   * 获取我的余额
   */
  @Get('my')
  async getMyBalance(@Req() req: RequestWithUserOrAdmin) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    const balance = await this.balanceService.getBalance(userId);

    return {
      success: true,
      data: {
        availableCny: balance.availableCny,
        frozenCny: balance.frozenCny,
        totalIncomeCny: balance.totalIncomeCny,
        totalWithdrawalCny: balance.totalWithdrawalCny,
      },
    };
  }

  /**
   * 获取余额变动记录
   */
  @Get('records')
  async getBalanceRecords(
    @Req() req: RequestWithUserOrAdmin,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    const records = await this.balanceService.getBalanceRecords(
      userId,
      limit ? parseInt(limit, 10) : 50,
    );

    return {
      success: true,
      data: records,
    };
  }

  /**
   * 申请提现
   */
  @Post('withdrawals')
  async requestWithdrawal(
    @Req() req: RequestWithUserOrAdmin,
    @Body()
    body: {
      amountCny: number;
      paymentMethod: 'ALIPAY' | 'WECHAT' | 'BANK';
      accountInfo: string;
    },
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    if (!body.amountCny || body.amountCny <= 0) {
      throw new BadRequestException('提现金额必须大于0');
    }

    if (!body.paymentMethod) {
      throw new BadRequestException('请选择提现方式');
    }

    if (!body.accountInfo) {
      throw new BadRequestException('请填写收款账号信息');
    }

    const withdrawal = await this.balanceService.requestWithdrawal({
      userId,
      amountCny: body.amountCny,
      paymentMethod: body.paymentMethod,
      accountInfo: body.accountInfo,
    });

    return {
      success: true,
      data: withdrawal,
    };
  }

  /**
   * 获取我的提现记录
   */
  @Get('withdrawals')
  async getMyWithdrawals(@Req() req: RequestWithUserOrAdmin) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    const withdrawals = await this.balanceService.getWithdrawals(userId);

    return {
      success: true,
      data: withdrawals,
    };
  }

  /**
   * 创建余额充值单（返回支付宝收银台跳转 URL）
   */
  @Post('recharge')
  async createRecharge(
    @Req() req: RequestWithUserOrAdmin,
    @Body() body: { amountCny: number },
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }
    if (typeof body.amountCny !== 'number') {
      throw new BadRequestException('充值金额格式无效');
    }

    const result = await this.rechargeService.createRecharge(
      userId,
      body.amountCny,
    );
    return { success: true, data: result };
  }

  /**
   * 查询充值状态（refresh=true 主动向支付宝查单收敛）
   */
  @Get('recharge/:id')
  async getRechargeStatus(
    @Req() req: RequestWithUserOrAdmin,
    @Param('id') rechargeId: string,
    @Query('refresh') refresh?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    const status = await this.rechargeService.getRechargeStatus(
      rechargeId,
      userId,
      refresh === 'true' || refresh === '1',
    );
    return { success: true, data: status };
  }

  /**
   * 我的充值记录
   */
  @Get('recharges')
  async getMyRecharges(
    @Req() req: RequestWithUserOrAdmin,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    const recharges = await this.rechargeService.getMyRecharges(
      userId,
      limit ? Math.min(parseInt(limit, 10) || 20, 100) : 20,
    );
    return { success: true, data: recharges };
  }

  // ==================== 管理员接口 ====================

  /**
   * 提现列表（管理员，可按状态过滤）
   */
  @Get('admin/withdrawals')
  @UseGuards(AdminGuard)
  async listWithdrawals(@Query('status') status?: string) {
    const withdrawals = await this.balanceService.getWithdrawalsForAdmin(
      status,
    );
    return { success: true, data: withdrawals };
  }

  /**
   * 获取待审核的提现申请（管理员）
   */
  @Get('admin/withdrawals/pending')
  @UseGuards(AdminGuard)
  async getPendingWithdrawals() {
    const withdrawals = await this.balanceService.getPendingWithdrawals();

    return {
      success: true,
      data: withdrawals,
    };
  }

  /**
   * 审核提现申请（管理员）
   */
  @Post('admin/withdrawals/:id/review')
  @UseGuards(AdminGuard)
  async reviewWithdrawal(
    @Param('id') withdrawalId: string,
    @Req() req: RequestWithUserOrAdmin,
    @Body()
    body: {
      approved: boolean;
      notes?: string;
    },
  ) {
    const adminId = req.admin?.id;
    if (!adminId) {
      throw new BadRequestException('Admin not authenticated');
    }

    const withdrawal = await this.balanceService.reviewWithdrawal({
      withdrawalId,
      adminUserId: adminId,
      approved: body.approved,
      notes: body.notes,
    });

    return {
      success: true,
      data: withdrawal,
    };
  }

  /**
   * 完成提现（管理员）
   */
  @Post('admin/withdrawals/:id/complete')
  @UseGuards(AdminGuard)
  async completeWithdrawal(
    @Param('id') withdrawalId: string,
    @Body() body: { transactionId: string },
  ) {
    if (!body.transactionId) {
      throw new BadRequestException('transactionId is required');
    }

    const withdrawal = await this.balanceService.completeWithdrawal({
      withdrawalId,
      transactionId: body.transactionId,
    });

    return {
      success: true,
      data: withdrawal,
    };
  }
}
