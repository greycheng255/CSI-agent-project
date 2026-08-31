import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Headers,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PaymentService } from './payment.service';
import { OnlinePaymentService } from './online-payment.service';
import { PaymentCodeType } from './entities/user-payment-code.entity';
import { PlatformCodeType } from './entities/platform-payment-code.entity';
import {
  UserOrAdminGuard,
  type RequestWithUserOrAdmin,
} from '../auth/user-or-admin.guard';
import { AdminPermissionGuard } from '../admin/admin.guard';
import { RequirePermission } from '../admin/admin-permission.decorator';
import { ADMIN_PERMISSIONS } from '../admin/admin-permissions';

@Controller('api/v1/payments')
@UseGuards(UserOrAdminGuard)
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly onlinePaymentService: OnlinePaymentService,
  ) {}

  // ==================== 用户收款码管理 ====================

  /**
   * 上传用户收款码
   */
  @Post('my-codes')
  @UseInterceptors(FileInterceptor('file'))
  async uploadUserPaymentCode(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { type: PaymentCodeType; accountName?: string },
    @Req() req: RequestWithUserOrAdmin,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    if (!body.type) {
      throw new BadRequestException('type is required (ALIPAY or WECHAT)');
    }

    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    const result = await this.paymentService.uploadUserPaymentCode(
      userId,
      body.type,
      file,
      body.accountName,
    );

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 获取我的收款码列表
   */
  @Get('my-codes')
  async getMyPaymentCodes(@Req() req: RequestWithUserOrAdmin) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    const result = await this.paymentService.getUserPaymentCodes(userId);

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 删除收款码
   */
  @Post('my-codes/:codeId/delete')
  async deleteUserPaymentCode(
    @Param('codeId') codeId: string,
    @Req() req: RequestWithUserOrAdmin,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    await this.paymentService.deleteUserPaymentCode(userId, codeId);

    return {
      success: true,
      message: 'Payment code deleted',
    };
  }

  /**
   * 设置默认收款码
   */
  @Post('my-codes/:codeId/default')
  async setDefaultPaymentCode(
    @Param('codeId') codeId: string,
    @Req() req: RequestWithUserOrAdmin,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    const result = await this.paymentService.setDefaultPaymentCode(
      userId,
      codeId,
    );

    return {
      success: true,
      data: result,
    };
  }

  // ==================== 平台收款码（管理员） ====================

  /**
   * 获取平台收款码列表
   */
  @Get('platform-codes')
  async getPlatformPaymentCodes() {
    const result = await this.paymentService.getPlatformPaymentCodes();

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 上传平台收款码（管理员）
   */
  @Post('platform-codes')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(ADMIN_PERMISSIONS.PLATFORM_CODES_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  async uploadPlatformPaymentCode(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { type: PlatformCodeType; accountName: string },
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    if (!body.type) {
      throw new BadRequestException('type is required');
    }
    if (!body.accountName) {
      throw new BadRequestException('accountName is required');
    }

    const result = await this.paymentService.uploadPlatformPaymentCode(
      body.type,
      file,
      body.accountName,
    );

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 获取所有平台收款码（管理员，包括已禁用）
   */
  @Get('platform-codes/all')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(ADMIN_PERMISSIONS.PLATFORM_CODES_MANAGE)
  async getAllPlatformPaymentCodes() {
    const result = await this.paymentService.getAllPlatformPaymentCodes();

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 更新平台收款码（管理员）
   */
  @Post('platform-codes/:codeId/update')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(ADMIN_PERMISSIONS.PLATFORM_CODES_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  async updatePlatformPaymentCode(
    @Param('codeId') codeId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: { accountName?: string; isActive?: string; sortOrder?: string },
  ) {
    const result = await this.paymentService.updatePlatformPaymentCode(codeId, {
      file,
      accountName: body.accountName,
      isActive: body.isActive === 'true',
      sortOrder: body.sortOrder ? parseInt(body.sortOrder, 10) : undefined,
    });

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 删除平台收款码（管理员）
   */
  @Post('platform-codes/:codeId/delete')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(ADMIN_PERMISSIONS.PLATFORM_CODES_MANAGE)
  async deletePlatformPaymentCode(@Param('codeId') codeId: string) {
    await this.paymentService.deletePlatformPaymentCode(codeId);

    return {
      success: true,
      message: 'Platform payment code deleted',
    };
  }

  // ==================== 订单支付流程 ====================

  /**
   * 创建订单支付 - 获取平台收款码
   */
  @Post('order/:orderId/create')
  async createOrderPayment(
    @Param('orderId') orderId: string,
    @Req() req: RequestWithUserOrAdmin,
  ) {
    if (!req.user) throw new BadRequestException('User not authenticated');
    const result = await this.paymentService.createOrderPayment(
      orderId,
      req.user.id,
    );

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 获取订单支付信息
   */
  @Get('order/:orderId')
  async getOrderPayment(
    @Param('orderId') orderId: string,
    @Req() req: RequestWithUserOrAdmin,
  ) {
    if (!req.user) throw new BadRequestException('User not authenticated');
    const result = await this.paymentService.getOrderPayment(
      orderId,
      req.user.id,
    );

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 雇主确认已支付（上传支付凭证）
   */
  @Post('order/:orderId/confirm-payment')
  @UseInterceptors(FileInterceptor('file'))
  async confirmPayment(
    @Param('orderId') orderId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { platformCodeId: string },
    @Req() req: RequestWithUserOrAdmin,
  ) {
    if (!file) {
      throw new BadRequestException('Payment proof file is required');
    }
    if (!body.platformCodeId) {
      throw new BadRequestException('platformCodeId is required');
    }

    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    const result = await this.paymentService.confirmPayment(
      orderId,
      body.platformCodeId,
      file,
      userId,
    );

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 平台确认收到款项（管理员）
   */
  @Post('order/:orderId/confirm-received')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(ADMIN_PERMISSIONS.PAYMENT_RELEASE)
  async confirmPaymentReceived(
    @Param('orderId') orderId: string,
    @Req() req: RequestWithUserOrAdmin,
  ) {
    const adminId = req.admin?.id;
    if (!adminId) {
      throw new BadRequestException('Admin not authenticated');
    }

    const result = await this.paymentService.confirmPaymentReceived(
      orderId,
      adminId,
    );

    return {
      success: true,
      data: result,
    };
  }

  // ==================== 订单打款流程 ====================

  /**
   * 获取待打款信息
   */
  @Get('order/:orderId/payout-info')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(ADMIN_PERMISSIONS.PAYMENT_RELEASE)
  async getPayoutInfo(@Param('orderId') orderId: string) {
    const result = await this.paymentService.getPayoutInfo(orderId);

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 平台确认已打款给开发者（上传打款凭证）
   */
  @Post('order/:orderId/confirm-payout')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(ADMIN_PERMISSIONS.PAYMENT_RELEASE)
  @UseInterceptors(FileInterceptor('file'))
  async confirmPayout(
    @Param('orderId') orderId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: RequestWithUserOrAdmin,
  ) {
    if (!file) {
      throw new BadRequestException('Payout proof file is required');
    }

    const adminId = req.admin?.id;
    if (!adminId) {
      throw new BadRequestException('Admin not authenticated');
    }

    const result = await this.paymentService.confirmPayout(
      orderId,
      file,
      adminId,
    );

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 开发者确认收到款项
   */
  @Post('order/:orderId/confirm-payout-received')
  async confirmPayoutReceived(
    @Param('orderId') orderId: string,
    @Req() req: RequestWithUserOrAdmin,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    const result = await this.paymentService.confirmPayoutReceived(
      orderId,
      userId,
    );

    return {
      success: true,
      data: result,
    };
  }

  // ==================== 支付宝在线支付 ====================

  /**
   * 为当前用户自己的待支付订单创建支付宝电脑网站支付。
   * 返回支付 URL，前端应在新窗口打开。
   */
  @Post('alipay/orders/:orderId')
  async createOnlineAlipayPayment(
    @Param('orderId') orderId: string,
    @Req() req: RequestWithUserOrAdmin,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('User not authenticated');
    const result = await this.onlinePaymentService.createAlipayPayment(
      orderId,
      userId,
    );
    return { success: true, data: result };
  }

  /** 查询当前用户自己的支付宝支付状态，可选主动向渠道刷新。 */
  @Get('alipay/orders/:orderId/status')
  async getOnlineAlipayPaymentStatus(
    @Param('orderId') orderId: string,
    @Query('refresh') refresh: string | undefined,
    @Req() req: RequestWithUserOrAdmin,
  ) {
    if (!req.user) throw new BadRequestException('User not authenticated');
    const result = await this.onlinePaymentService.getAlipayPaymentStatus(
      orderId,
      req.user.id,
      refresh === '1',
    );
    return { success: true, data: result };
  }

  // ==================== 兼容旧版 API ====================

  /**
   * 创建支付宝支付订单（旧版兼容）
   */
  @Post('alipay/create')
  async createAlipayOrder(
    @Body() body: { orderId: string; returnUrl?: string },
    @Req() req: RequestWithUserOrAdmin,
  ) {
    if (!req.user) throw new BadRequestException('User not authenticated');
    if (!body.orderId) {
      throw new BadRequestException('orderId is required');
    }

    const result = await this.paymentService.createAlipayOrder(
      body.orderId,
      body.returnUrl,
      req.user.id,
    );

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 模拟支付成功（用于测试）
   */
  @Get('alipay/mock-pay')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(ADMIN_PERMISSIONS.PAYMENT_RELEASE)
  async mockPay(@Query('out_trade_no') outTradeNo: string) {
    if (!outTradeNo) {
      throw new BadRequestException('out_trade_no is required');
    }

    await this.paymentService.mockPaymentSuccess(outTradeNo);

    return {
      success: true,
      message: 'Payment mock success',
    };
  }

  /**
   * 执行分账（旧版兼容）
   */
  @Post(':orderId/payout')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(ADMIN_PERMISSIONS.PAYMENT_RELEASE)
  async executePayout(@Param('orderId') orderId: string) {
    await this.paymentService.executePayout(orderId);

    return {
      success: true,
      message: 'Payout executed',
    };
  }

  /**
   * 获取订单支付状态（旧版兼容）
   */
  @Get(':orderId/status')
  async getPaymentStatus(@Param('orderId') orderId: string) {
    const payment = await this.paymentService.getPaymentByOrder(orderId);

    return {
      success: true,
      data: payment,
    };
  }
}
