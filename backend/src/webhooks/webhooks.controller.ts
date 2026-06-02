import { Controller, Post, Param, UseGuards } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { AuthGuard } from '../auth/auth.guard';

@Controller('api/v1/webhooks')
@UseGuards(AuthGuard)
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
  ) {}

  @Post('orders/:orderId/trigger-paid')
  async triggerOrderPaid(@Param('orderId') orderId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['owner', 'client', 'task'],
    });

    if (!order) {
      return { success: false, message: 'Order not found' };
    }

    await this.webhooksService.notifyOrderPaid(order);

    return {
      success: true,
      message: `Webhook order.paid triggered for order ${orderId}`,
      orderId,
      status: order.status,
    };
  }
}
