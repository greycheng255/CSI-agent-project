import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type FindOptionsWhere } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { Payout } from './entities/payout.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { WebhooksService } from '../webhooks/webhooks.service';
import {
  UserPaymentCode,
  PaymentCodeType,
} from './entities/user-payment-code.entity';
import {
  PlatformPaymentCode,
  PlatformCodeType,
} from './entities/platform-payment-code.entity';
import {
  OrderPayment,
  OrderPaymentStatus,
  OrderPayoutStatus,
} from './entities/order-payment.entity';
import { UploadService } from '../upload/upload.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Payout)
    private readonly payoutRepo: Repository<Payout>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(UserPaymentCode)
    private readonly userPaymentCodeRepo: Repository<UserPaymentCode>,
    @InjectRepository(PlatformPaymentCode)
    private readonly platformPaymentCodeRepo: Repository<PlatformPaymentCode>,
    @InjectRepository(OrderPayment)
    private readonly orderPaymentRepo: Repository<OrderPayment>,
    private readonly webhooksService: WebhooksService,
    private readonly uploadService: UploadService,
  ) {}

  // ==================== 用户收款码管理 ====================

  /**
   * 上传用户收款码
   */
  async uploadUserPaymentCode(
    userId: string,
    type: PaymentCodeType,
    file: Express.Multer.File,
    accountName?: string,
  ): Promise<UserPaymentCode> {
    // multer 已保存文件到磁盘，直接使用文件路径
    const baseUrl = process.env.UPLOAD_BASE_URL || 'http://122.51.51.177:4000';
    const folder = 'payment-codes';
    const fileName = file.filename;
    const qrCodeUrl = `${baseUrl}/uploads/${folder}/${fileName}`;

    // 如果设置为默认，先将其他收款码设为非默认
    if (type) {
      await this.userPaymentCodeRepo.update(
        { userId, type },
        { isDefault: false },
      );
    }

    // 创建收款码记录
    const paymentCode = this.userPaymentCodeRepo.create({
      userId,
      type,
      qrCodeUrl,
      accountName: accountName || null,
      isDefault: true,
    });

    return this.userPaymentCodeRepo.save(paymentCode);
  }

  /**
   * 获取用户的收款码列表
   */
  async getUserPaymentCodes(userId: string): Promise<UserPaymentCode[]> {
    return this.userPaymentCodeRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 获取用户默认收款码
   */
  async getUserDefaultPaymentCode(
    userId: string,
    type?: PaymentCodeType,
  ): Promise<UserPaymentCode | null> {
    const where: FindOptionsWhere<UserPaymentCode> = {
      userId,
      isDefault: true,
    };
    if (type) {
      where.type = type;
    }
    return this.userPaymentCodeRepo.findOne({
      where,
    });
  }

  /**
   * 删除用户收款码
   */
  async deleteUserPaymentCode(userId: string, codeId: string): Promise<void> {
    const code = await this.userPaymentCodeRepo.findOne({
      where: { id: codeId, userId },
    });

    if (!code) {
      throw new NotFoundException('Payment code not found');
    }

    await this.userPaymentCodeRepo.remove(code);
  }

  /**
   * 设置默认收款码
   */
  async setDefaultPaymentCode(
    userId: string,
    codeId: string,
  ): Promise<UserPaymentCode> {
    const code = await this.userPaymentCodeRepo.findOne({
      where: { id: codeId, userId },
    });

    if (!code) {
      throw new NotFoundException('Payment code not found');
    }

    // 将该类型的其他收款码设为非默认
    await this.userPaymentCodeRepo.update(
      { userId, type: code.type },
      { isDefault: false },
    );

    code.isDefault = true;
    return this.userPaymentCodeRepo.save(code);
  }

  // ==================== 平台收款码管理（管理员） ====================

  /**
   * 获取平台收款码列表
   */
  async getPlatformPaymentCodes(): Promise<PlatformPaymentCode[]> {
    return this.platformPaymentCodeRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
  }

  /**
   * 上传平台收款码（管理员）
   */
  async uploadPlatformPaymentCode(
    type: PlatformCodeType,
    file: Express.Multer.File,
    accountName: string,
  ): Promise<PlatformPaymentCode> {
    // multer 已保存文件到磁盘，直接使用文件路径
    const baseUrl = process.env.UPLOAD_BASE_URL || 'http://122.51.51.177:4000';
    const folder = 'platform-payment-codes';
    const fileName = file.filename;
    const qrCodeUrl = `${baseUrl}/uploads/${folder}/${fileName}`;

    const paymentCode = this.platformPaymentCodeRepo.create({
      type,
      qrCodeUrl,
      accountName,
      isActive: true,
    });

    return this.platformPaymentCodeRepo.save(paymentCode);
  }

  /**
   * 获取所有平台收款码（管理员）
   */
  async getAllPlatformPaymentCodes(): Promise<PlatformPaymentCode[]> {
    return this.platformPaymentCodeRepo.find({
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
  }

  /**
   * 更新平台收款码（管理员）
   */
  async updatePlatformPaymentCode(
    codeId: string,
    data: {
      file?: Express.Multer.File;
      accountName?: string;
      isActive?: boolean;
      sortOrder?: number;
    },
  ): Promise<PlatformPaymentCode> {
    const code = await this.platformPaymentCodeRepo.findOne({
      where: { id: codeId },
    });

    if (!code) {
      throw new NotFoundException('Platform payment code not found');
    }

    if (data.file) {
      const baseUrl =
        process.env.UPLOAD_BASE_URL || 'http://122.51.51.177:4000';
      const folder = 'platform-payment-codes';
      const fileName = data.file.filename;
      code.qrCodeUrl = `${baseUrl}/uploads/${folder}/${fileName}`;
    }

    if (data.accountName !== undefined) {
      code.accountName = data.accountName;
    }

    if (data.isActive !== undefined) {
      code.isActive = data.isActive;
    }

    if (data.sortOrder !== undefined) {
      code.sortOrder = data.sortOrder;
    }

    return this.platformPaymentCodeRepo.save(code);
  }

  /**
   * 删除平台收款码（管理员）
   */
  async deletePlatformPaymentCode(codeId: string): Promise<void> {
    const code = await this.platformPaymentCodeRepo.findOne({
      where: { id: codeId },
    });

    if (!code) {
      throw new NotFoundException('Platform payment code not found');
    }

    await this.platformPaymentCodeRepo.remove(code);
  }

  // ==================== 订单支付流程 ====================

  /**
   * 创建订单支付 - 返回平台收款码给雇主扫码支付
   */
  async createOrderPayment(
    orderId: string,
    requesterUserId: string,
  ): Promise<{
    orderPayment: OrderPayment;
    platformCodes: PlatformPaymentCode[];
  }> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['task', 'owner', 'client'],
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const clientId = order.client?.id || order.clientUserId;
    if (!clientId || clientId !== requesterUserId) {
      throw new ForbiddenException('Only the client can create payment');
    }

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException('Order is not in pending payment status');
    }

    // 检查是否已存在支付记录
    let orderPayment = await this.orderPaymentRepo.findOne({
      where: { orderId },
    });

    if (!orderPayment) {
      // 获取开发者的默认收款码
      const ownerCode = await this.getUserDefaultPaymentCode(order.owner.id);

      // 计算金额
      const platformFeeCny = 0;
      const payoutCny = order.amountCny;

      // 创建订单支付记录
      orderPayment = this.orderPaymentRepo.create({
        orderId,
        ownerCodeId: ownerCode?.id || null,
        paymentStatus: OrderPaymentStatus.PENDING,
        payoutStatus: OrderPayoutStatus.PENDING,
        amountCny: order.amountCny,
        platformFeeCny,
        payoutCny,
      });

      await this.orderPaymentRepo.save(orderPayment);
    } else if (
      orderPayment.platformFeeCny !== 0 ||
      orderPayment.payoutCny !== order.amountCny
    ) {
      orderPayment.platformFeeCny = 0;
      orderPayment.payoutCny = order.amountCny;
      await this.orderPaymentRepo.save(orderPayment);
    }

    // 获取平台收款码
    const platformCodes = await this.getPlatformPaymentCodes();

    return { orderPayment, platformCodes };
  }

  /**
   * 获取订单支付信息
   */
  async getOrderPayment(
    orderId: string,
    requesterUserId: string,
  ): Promise<OrderPayment | null> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['client'],
    });
    if (!order) throw new NotFoundException('Order not found');
    const clientId = order.client?.id || order.clientUserId;
    if (!clientId || clientId !== requesterUserId) {
      throw new ForbiddenException('Only the client can view payment');
    }
    const orderPayment = await this.orderPaymentRepo.findOne({
      where: { orderId },
      relations: ['platformCode', 'ownerCode'],
    });
    if (
      orderPayment &&
      (orderPayment.platformFeeCny !== 0 ||
        orderPayment.payoutCny !== orderPayment.amountCny)
    ) {
      orderPayment.platformFeeCny = 0;
      orderPayment.payoutCny = orderPayment.amountCny;
      return this.orderPaymentRepo.save(orderPayment);
    }
    return orderPayment;
  }

  /**
   * 雇主确认已支付（上传支付凭证）
   */
  async confirmPayment(
    orderId: string,
    platformCodeId: string,
    file: Express.Multer.File,
    userId: string,
  ): Promise<OrderPayment> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['client'],
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // 验证用户是雇主
    if (order.client.id !== userId) {
      throw new BadRequestException('Only client can confirm payment');
    }

    const orderPayment = await this.orderPaymentRepo.findOne({
      where: { orderId },
    });

    if (!orderPayment) {
      throw new NotFoundException('Order payment not found');
    }

    if (orderPayment.paymentStatus !== OrderPaymentStatus.PENDING) {
      throw new BadRequestException('Payment already confirmed');
    }

    // multer 已保存文件到磁盘，直接使用文件路径
    const baseUrl = process.env.UPLOAD_BASE_URL || 'http://122.51.51.177:4000';
    const folder = 'payment-proofs';
    const fileName = file.filename;
    const paymentProofUrl = `${baseUrl}/uploads/${folder}/${fileName}`;

    orderPayment.platformCodeId = platformCodeId;
    orderPayment.paymentProofUrl = paymentProofUrl;
    orderPayment.paymentStatus = OrderPaymentStatus.PAID;
    orderPayment.paidAt = new Date();

    await this.orderPaymentRepo.save(orderPayment);

    // 更新订单状态
    order.status = OrderStatus.IN_PROGRESS;
    order.escrowedAt = new Date();
    order.platformFeeRate = 0;
    order.platformFeeCny = 0;
    order.payoutCny = order.amountCny;
    await this.orderRepo.save(order);

    // 触发 Webhook 通知 Agent
    void this.webhooksService.notifyOrderPaid(order);

    this.logger.log(`Payment confirmed for order: ${orderId}`);

    return orderPayment;
  }

  /**
   * 平台确认收到款项（管理员）
   */
  async confirmPaymentReceived(
    orderId: string,
    adminId: string,
  ): Promise<OrderPayment> {
    const orderPayment = await this.orderPaymentRepo.findOne({
      where: { orderId },
      relations: ['order'],
    });

    if (!orderPayment) {
      throw new NotFoundException('Order payment not found');
    }

    if (orderPayment.paymentStatus !== OrderPaymentStatus.PAID) {
      throw new BadRequestException('Payment not in paid status');
    }

    orderPayment.paymentStatus = OrderPaymentStatus.CONFIRMED;
    orderPayment.paymentConfirmedAt = new Date();
    orderPayment.paymentConfirmedBy = adminId;

    return this.orderPaymentRepo.save(orderPayment);
  }

  // ==================== 订单打款流程 ====================

  /**
   * 获取待打款信息（给平台运营人员查看）
   */
  async getPayoutInfo(orderId: string): Promise<{
    orderPayment: OrderPayment;
    ownerPaymentCode: UserPaymentCode | null;
  }> {
    const orderPayment = await this.orderPaymentRepo.findOne({
      where: { orderId },
      relations: ['order', 'order.owner'],
    });

    if (!orderPayment) {
      throw new NotFoundException('Order payment not found');
    }

    let ownerPaymentCode: UserPaymentCode | null = null;

    if (orderPayment.ownerCodeId) {
      ownerPaymentCode = await this.userPaymentCodeRepo.findOne({
        where: { id: orderPayment.ownerCodeId },
      });
    }

    // 如果没有设置收款码，尝试获取用户的默认收款码
    if (!ownerPaymentCode && orderPayment.order?.owner?.id) {
      ownerPaymentCode = await this.getUserDefaultPaymentCode(
        orderPayment.order.owner.id,
      );
    }

    return { orderPayment, ownerPaymentCode };
  }

  /**
   * 平台确认已打款给开发者（上传打款凭证）
   */
  async confirmPayout(
    orderId: string,
    file: Express.Multer.File,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _adminId: string,
  ): Promise<OrderPayment> {
    // _adminId 参数保留用于审计日志记录
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const orderPayment = await this.orderPaymentRepo.findOne({
      where: { orderId },
    });

    if (!orderPayment) {
      throw new NotFoundException('Order payment not found');
    }

    if (orderPayment.payoutStatus !== OrderPayoutStatus.PENDING) {
      throw new BadRequestException('Payout already processed');
    }

    // multer 已保存文件到磁盘，直接使用文件路径
    const baseUrl = process.env.UPLOAD_BASE_URL || 'http://122.51.51.177:4000';
    const folder = 'payout-proofs';
    const fileName = file.filename;
    const payoutProofUrl = `${baseUrl}/uploads/${folder}/${fileName}`;

    orderPayment.payoutProofUrl = payoutProofUrl;
    orderPayment.payoutStatus = OrderPayoutStatus.PAID;
    orderPayment.payoutAt = new Date();

    await this.orderPaymentRepo.save(orderPayment);

    // 更新订单状态
    if (order.status === OrderStatus.ACCEPTED) {
      order.status = OrderStatus.COMPLETED;
      order.releasedAt = new Date();
      await this.orderRepo.save(order);
    }

    this.logger.log(`Payout confirmed for order: ${orderId}`);

    return orderPayment;
  }

  /**
   * 开发者确认收到款项
   */
  async confirmPayoutReceived(
    orderId: string,
    userId: string,
  ): Promise<OrderPayment> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['owner'],
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // 验证用户是开发者
    if (order.owner.id !== userId) {
      throw new BadRequestException('Only owner can confirm payout received');
    }

    const orderPayment = await this.orderPaymentRepo.findOne({
      where: { orderId },
    });

    if (!orderPayment) {
      throw new NotFoundException('Order payment not found');
    }

    if (orderPayment.payoutStatus !== OrderPayoutStatus.PAID) {
      throw new BadRequestException('Payout not in paid status');
    }

    orderPayment.payoutStatus = OrderPayoutStatus.CONFIRMED;
    orderPayment.payoutConfirmedAt = new Date();
    orderPayment.payoutConfirmedBy = userId;

    return this.orderPaymentRepo.save(orderPayment);
  }

  // ==================== 兼容旧版 API ====================

  /**
   * 创建支付宝支付订单（旧版兼容）
   */
  async createAlipayOrder(
    orderId: string,
    _returnUrl?: string,
    requesterUserId?: string,
  ): Promise<{ paymentUrl: string; outTradeNo: string }> {
    if (!requesterUserId) {
      throw new ForbiddenException('User is required');
    }
    const { orderPayment, platformCodes } = await this.createOrderPayment(
      orderId,
      requesterUserId,
    );

    // 返回第一个平台收款码的 URL
    const firstCode = platformCodes[0];
    if (!firstCode) {
      throw new BadRequestException('No platform payment code available');
    }

    // _returnUrl 参数保留用于未来扩展（支付后跳转URL）

    return {
      paymentUrl: firstCode.qrCodeUrl,
      outTradeNo: orderPayment.id,
    };
  }

  /**
   * 模拟支付成功（旧版兼容，用于测试）
   */
  async mockPaymentSuccess(outTradeNo: string): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException('Mock payment is not available');
    }
    const orderPayment = await this.orderPaymentRepo.findOne({
      where: { id: outTradeNo },
      relations: ['order'],
    });

    if (!orderPayment) {
      throw new NotFoundException('Payment not found');
    }

    orderPayment.paymentStatus = OrderPaymentStatus.PAID;
    orderPayment.paidAt = new Date();
    await this.orderPaymentRepo.save(orderPayment);

    // 更新订单状态
    const order = orderPayment.order;
    order.status = OrderStatus.IN_PROGRESS;
    order.escrowedAt = new Date();
    order.platformFeeRate = 0;
    order.platformFeeCny = 0;
    order.payoutCny = order.amountCny;
    await this.orderRepo.save(order);

    // 触发 Webhook
    void this.webhooksService.notifyOrderPaid(order);
  }

  /**
   * 执行分账（旧版兼容）
   */
  async executePayout(orderId: string): Promise<void> {
    const orderPayment = await this.orderPaymentRepo.findOne({
      where: { orderId },
    });

    if (!orderPayment) {
      throw new NotFoundException('Order payment not found');
    }

    // 标记为已打款（实际打款由平台运营人员操作）
    orderPayment.payoutStatus = OrderPayoutStatus.PAID;
    orderPayment.payoutAt = new Date();
    await this.orderPaymentRepo.save(orderPayment);

    // 更新订单状态
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (order && order.status === OrderStatus.ACCEPTED) {
      order.status = OrderStatus.COMPLETED;
      order.releasedAt = new Date();
      await this.orderRepo.save(order);
    }
  }

  /**
   * 获取支付详情（旧版兼容）
   */
  async getPaymentByOrder(orderId: string): Promise<Payment | null> {
    return this.paymentRepo.findOne({
      where: { order: { id: orderId } },
      order: { createdAt: 'DESC' },
    });
  }
}
