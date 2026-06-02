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
import { PaymentCodeType } from './entities/user-payment-code.entity';
import { PlatformCodeType } from './entities/platform-payment-code.entity';
import { AuthGuard } from '../auth/auth.guard';
import type { RequestWithUser } from '../auth/auth.guard';
import { AdminGuard } from '../admin/admin.guard';

@Controller('api/v1/payments')
@UseGuards(AuthGuard)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  // ==================== 用户收款码管理 ====================

  /**
   * 上传用户收款码
   */
  @Post('my-codes')
  @UseInterceptors(FileInterceptor('file'))
  async uploadUserPaymentCode(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { type: PaymentCodeType; accountName?: string },
    @Req() req: RequestWithUser,
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
  async getMyPaymentCodes(@Req() req: RequestWithUser) {
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
    @Req() req: RequestWithUser,
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
    @Req() req: RequestWithUser,
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
  @UseGuards(AdminGuard)
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
  @UseGuards(AdminGuard)
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
  @UseGuards(AdminGuard)
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
  @UseGuards(AdminGuard)
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
  async createOrderPayment(@Param('orderId') orderId: string) {
    const result = await this.paymentService.createOrderPayment(orderId);

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 获取订单支付信息
   */
  @Get('order/:orderId')
  async getOrderPayment(@Param('orderId') orderId: string) {
    const result = await this.paymentService.getOrderPayment(orderId);

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
    @Req() req: RequestWithUser,
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
  async confirmPaymentReceived(
    @Param('orderId') orderId: string,
    @Req() req: RequestWithUser,
  ) {
    const adminId = req.user?.id;
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
  @UseInterceptors(FileInterceptor('file'))
  async confirmPayout(
    @Param('orderId') orderId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: RequestWithUser,
  ) {
    if (!file) {
      throw new BadRequestException('Payout proof file is required');
    }

    const adminId = req.user?.id;
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
    @Req() req: RequestWithUser,
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

  // ==================== 兼容旧版 API ====================

  /**
   * 创建支付宝支付订单（旧版兼容）
   */
  @Post('alipay/create')
  async createAlipayOrder(
    @Body() body: { orderId: string; returnUrl?: string },
  ) {
    if (!body.orderId) {
      throw new BadRequestException('orderId is required');
    }

    const result = await this.paymentService.createAlipayOrder(
      body.orderId,
      body.returnUrl,
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
