import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  WebhookDelivery,
  WebhookDeliveryStatus,
} from './entities/webhook-delivery.entity';
import { Agent, AgentStatus } from '../agents/entities/agent.entity';
import { Task } from '../tasks/entities/task.entity';
import { Order } from '../orders/entities/order.entity';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly maxRetries = 3;
  private readonly retryDelayMs = 5000;

  // 自动执行开关 - 默认关闭，需要手动开启才自动执行任务
  private readonly autoExecutionEnabled =
    process.env.AUTO_EXECUTION_ENABLED === 'true';

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly webhookDeliveryRepo: Repository<WebhookDelivery>,
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,
  ) {
    this.logger.log(`Auto execution enabled: ${this.autoExecutionEnabled}`);
  }

  /**
   * 当新任务发布时，推送给所有在线的 Agent
   */
  async notifyTaskCreated(task: Task): Promise<void> {
    const onlineAgents = await this.agentRepo.find({
      where: { status: AgentStatus.ONLINE },
    });

    for (const agent of onlineAgents) {
      if (!agent.webhookUrl) continue;

      const payload = {
        event: 'task.created',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          title: task.title,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
          budgetCny: task.budgetCny,
          expectedDeliveryAt: task.expectedDeliveryAt,
        },
      };

      await this.createDelivery(agent, task.id, payload);
    }
  }

  /**
   * 当订单状态变更时，推送给相关 Agent
   */
  async notifyOrderStatusChanged(order: Order, event: string): Promise<void> {
    const agent = await this.agentRepo.findOne({
      where: { owner: { id: order.owner.id } },
    });

    if (!agent || !agent.webhookUrl) return;

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data: {
        orderId: order.id,
        taskId: order.task.id,
        status: order.status,
        amountCny: order.amountCny,
        clientId: order.client.id,
      },
    };

    await this.createDelivery(agent, order.task.id, payload);
  }

  /**
   * 当雇主选择报价后，通知 Agent 中标
   */
  async notifyBidSelected(order: Order): Promise<void> {
    await this.notifyOrderStatusChanged(order, 'order.bid_selected');
  }

  /**
   * 当订单支付成功后，通知 Agent 开始执行
   *
   * 注意：只有开启 AUTO_EXECUTION_ENABLED=true 时才会发送 webhook 触发自动执行
   */
  async notifyOrderPaid(order: Order): Promise<void> {
    if (!this.autoExecutionEnabled) {
      this.logger.log(
        `[Auto-Execution] Disabled. Skipping webhook for order ${order.id}. Set AUTO_EXECUTION_ENABLED=true to enable.`,
      );
      return;
    }
    await this.notifyOrderStatusChanged(order, 'order.paid');
  }

  /**
   * 当交付被验收后，通知 Agent
   */
  async notifyOrderAccepted(order: Order): Promise<void> {
    await this.notifyOrderStatusChanged(order, 'order.accepted');
  }

  /**
   * 当订单完成（资金释放）后，通知 Agent
   */
  async notifyOrderCompleted(order: Order): Promise<void> {
    await this.notifyOrderStatusChanged(order, 'order.completed');
  }

  /**
   * 当交付被拒绝时，通知 Agent
   */
  async notifyOrderRejected(order: Order, reason?: string): Promise<void> {
    const agent = await this.agentRepo.findOne({
      where: { owner: { id: order.owner.id } },
    });

    if (!agent || !agent.webhookUrl) return;

    const payload = {
      event: 'order.rejected',
      timestamp: new Date().toISOString(),
      data: {
        orderId: order.id,
        taskId: order.task.id,
        status: order.status,
        reason: reason || '雇主拒绝验收',
      },
    };

    await this.createDelivery(agent, order.task.id, payload);
  }

  /**
   * 当有新交付提交时，通知雇主
   */
  async notifyDeliverySubmitted(order: Order, delivery: any): Promise<void> {
    // 这里可以扩展为通知雇主（通过邮件、短信或前端推送）
    this.logger.log(
      `[Delivery] New delivery submitted | orderId=${order.id} | version=${delivery.version}`,
    );
  }

  /**
   * 创建 Webhook 投递记录并触发发送
   */
  private async createDelivery(
    agent: Agent,
    taskId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const delivery = this.webhookDeliveryRepo.create({
      agent,
      taskId,
      webhookUrl: agent.webhookUrl,
      payload,
      status: WebhookDeliveryStatus.PENDING,
      attempts: 0,
    });

    await this.webhookDeliveryRepo.save(delivery);

    // 异步发送，不阻塞主流程
    this.sendWebhook(delivery).catch((err: unknown) => {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Failed to send webhook: ${errorMessage}`);
    });
  }

  /**
   * 发送 Webhook 请求，带重试机制
   */
  private async sendWebhook(delivery: WebhookDelivery): Promise<void> {
    let attempts = delivery.attempts;

    while (attempts < this.maxRetries) {
      attempts++;
      delivery.attempts = attempts;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(delivery.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Genesis-Event':
              ((delivery.payload as Record<string, unknown>)
                ?.event as string) || 'unknown',
            'X-Genesis-Signature': this.generateSignature(
              delivery.payload as Record<string, unknown>,
            ),
          },
          body: JSON.stringify(delivery.payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          delivery.status = WebhookDeliveryStatus.SUCCESS;
          delivery.lastError = null;
          await this.webhookDeliveryRepo.save(delivery);
          this.logger.log(
            `Webhook sent successfully to ${delivery.webhookUrl}`,
          );
          return;
        } else {
          const errorText = await response.text();
          delivery.lastError = `HTTP ${response.status}: ${errorText}`;
          this.logger.warn(
            `Webhook failed (attempt ${attempts}): ${delivery.lastError}`,
          );
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        delivery.lastError = errorMessage;
        this.logger.warn(
          `Webhook error (attempt ${attempts}): ${errorMessage}`,
        );
      }

      await this.webhookDeliveryRepo.save(delivery);

      if (attempts < this.maxRetries) {
        await this.delay(this.retryDelayMs * attempts);
      }
    }

    delivery.status = WebhookDeliveryStatus.FAILED;
    await this.webhookDeliveryRepo.save(delivery);
    this.logger.error(
      `Webhook failed after ${this.maxRetries} attempts: ${delivery.webhookUrl}`,
    );
  }

  /**
   * 生成 Webhook 签名（简单实现，生产环境应使用 HMAC）
   */
  private generateSignature(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _payload: Record<string, unknown>,
  ): string {
    // TODO: 使用密钥生成 HMAC 签名
    // _payload 参数保留用于未来实现签名逻辑
    return 'signature-placeholder';
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 获取 Webhook 投递记录
   */
  async getDeliveriesByAgent(agentId: string): Promise<WebhookDelivery[]> {
    return this.webhookDeliveryRepo.find({
      where: { agent: { id: agentId } },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  /**
   * 重试失败的 Webhook
   */
  async retryFailedDelivery(deliveryId: string): Promise<void> {
    const delivery = await this.webhookDeliveryRepo.findOne({
      where: { id: deliveryId },
    });

    if (!delivery || delivery.status !== WebhookDeliveryStatus.FAILED) {
      return;
    }

    delivery.status = WebhookDeliveryStatus.PENDING;
    delivery.attempts = 0;
    await this.webhookDeliveryRepo.save(delivery);

    this.sendWebhook(delivery).catch((err: unknown) => {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Failed to retry webhook: ${errorMessage}`);
    });
  }
}
