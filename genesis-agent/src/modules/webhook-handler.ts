import express from 'express';
import { QuoteManager } from './quote-manager';
import { getLogger } from '../utils/logger';

const logger = getLogger();

/**
 * Webhook 处理器
 * 接收来自 Genesis 平台的通知
 */
export class WebhookHandler {
  private quoteManager: QuoteManager;
  private port: number;
  private app?: express.Application;
  private server?: any;

  constructor(quoteManager: QuoteManager, port: number = 3000) {
    this.quoteManager = quoteManager;
    this.port = port;
  }

  /**
   * 启动 Webhook 服务器
   */
  async start(): Promise<void> {
    this.app = express();
    this.app.use(express.json());

    // Webhook 接收端点
    this.app.post('/webhook', async (req, res) => {
      const { event, data } = req.body;

      logger.info(`[Webhook] Received event: ${event}`, { data });

      try {
        switch (event) {
          case 'order.paid':
            // 雇主支付完成，开始执行任务
            logger.info(`[Webhook] Order ${data.orderId} paid, starting execution...`);
            await this.quoteManager.executeOrder(data);
            break;

          case 'order.bid_selected':
            // 雇主选择了报价
            logger.info(`[Webhook] Bid selected for order ${data.orderId}`);
            break;

          case 'order.accepted':
            // 雇主验收通过
            logger.info(`[Webhook] Order ${data.orderId} accepted`);
            break;

          case 'order.completed':
            // 订单完成（资金已释放）
            logger.info(`[Webhook] Order ${data.orderId} completed`);
            break;

          default:
            logger.info(`[Webhook] Unhandled event: ${event}`);
        }

        res.status(200).json({ success: true });
      } catch (error: any) {
        logger.error('[Webhook] Error handling event:', error.message);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 健康检查端点
    this.app.get('/health', (req, res) => {
      res.status(200).json({ status: 'ok', service: 'genesis-agent' });
    });

    // 启动服务器
    return new Promise((resolve, reject) => {
      this.server = this.app!.listen(this.port, () => {
        logger.info(`🌐 Webhook server started on port ${this.port}`);
        logger.info(`📡 Webhook endpoint: http://localhost:${this.port}/webhook`);
        resolve();
      });

      this.server.on('error', (error: any) => {
        logger.error('Failed to start webhook server:', error.message);
        reject(error);
      });
    });
  }

  /**
   * 停止 Webhook 服务器
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      logger.info('Webhook server stopped');
    }
  }
}

export default WebhookHandler;
