import { Injectable, Logger } from '@nestjs/common';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { Task } from '../tasks/entities/task.entity';

export interface NotificationPayload {
  type: 'email' | 'sms' | 'webhook';
  recipient: string;
  subject?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /**
   * 发送订单状态变更通知
   */
  async notifyOrderStatusChange(
    order: Order,
    previousStatus: OrderStatus,
  ): Promise<void> {
    const clientEmail = order.client?.email;
    const ownerEmail = order.owner?.email;

    // 通知雇主
    if (clientEmail) {
      await this.sendNotification({
        type: 'email',
        recipient: clientEmail,
        subject: `订单状态更新 - ${order.status}`,
        content: `您的订单 ${order.id} 状态已从 ${previousStatus} 更新为 ${order.status}`,
        metadata: { orderId: order.id, status: order.status },
      });
    }

    // 通知 Agent 所有者
    if (ownerEmail) {
      await this.sendNotification({
        type: 'email',
        recipient: ownerEmail,
        subject: `订单状态更新 - ${order.status}`,
        content: `您的 Agent 参与的订单 ${order.id} 状态已更新为 ${order.status}`,
        metadata: { orderId: order.id, status: order.status },
      });
    }

    this.logger.log(`Order status notification sent for order: ${order.id}`);
  }

  /**
   * 通知新任务发布
   */
  async notifyNewTask(task: Task, agentEmails: string[]): Promise<void> {
    for (const email of agentEmails) {
      await this.sendNotification({
        type: 'email',
        recipient: email,
        subject: '新任务发布通知',
        content: `有新任务 "${task.title}" 发布了，预算 ${task.budgetCny} 元，快来竞标吧！`,
        metadata: { taskId: task.id, title: task.title },
      });
    }

    this.logger.log(
      `New task notification sent to ${agentEmails.length} agents`,
    );
  }

  /**
   * 通知订单已支付
   */
  async notifyOrderPaid(order: Order): Promise<void> {
    const ownerEmail = order.owner?.email;

    if (ownerEmail) {
      await this.sendNotification({
        type: 'email',
        recipient: ownerEmail,
        subject: '订单已支付，请开始执行',
        content: `订单 ${order.id} 已支付 ${order.amountCny} 元，请尽快开始执行任务。`,
        metadata: { orderId: order.id, amount: order.amountCny },
      });
    }

    this.logger.log(`Order paid notification sent for order: ${order.id}`);
  }

  /**
   * 通知交付已提交
   */
  async notifyDeliverySubmitted(order: Order): Promise<void> {
    const clientEmail = order.client?.email;

    if (clientEmail) {
      await this.sendNotification({
        type: 'email',
        recipient: clientEmail,
        subject: '交付物已提交，请验收',
        content: `订单 ${order.id} 的交付物已提交，请登录平台查看并验收。`,
        metadata: { orderId: order.id },
      });
    }

    this.logger.log(`Delivery notification sent for order: ${order.id}`);
  }

  /**
   * 通知仲裁结果
   */
  async notifyArbitrationResult(order: Order, result: string): Promise<void> {
    const clientEmail = order.client?.email;
    const ownerEmail = order.owner?.email;

    const content = `订单 ${order.id} 的仲裁结果：${result}`;

    if (clientEmail) {
      await this.sendNotification({
        type: 'email',
        recipient: clientEmail,
        subject: '仲裁结果通知',
        content,
        metadata: { orderId: order.id, result },
      });
    }

    if (ownerEmail) {
      await this.sendNotification({
        type: 'email',
        recipient: ownerEmail,
        subject: '仲裁结果通知',
        content,
        metadata: { orderId: order.id, result },
      });
    }

    this.logger.log(`Arbitration notification sent for order: ${order.id}`);
  }

  /**
   * 通用的通知发送方法
   * TODO: 实际项目中需要接入真实的邮件/短信服务商
   */
  private async sendNotification(payload: NotificationPayload): Promise<void> {
    // 模拟发送通知
    this.logger.log(
      `[${payload.type.toUpperCase()}] To: ${payload.recipient}, Subject: ${payload.subject}`,
    );

    // TODO: 接入真实的邮件服务商 (如 SendGrid, AWS SES)
    // TODO: 接入真实的短信服务商 (如 Twilio, 阿里云短信)

    // 模拟异步发送
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
