import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/realtime',
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private connectedClients = 0;

  handleConnection(client: Socket) {
    this.connectedClients++;
    this.logger.log(
      `Client connected: ${client.id}, total: ${this.connectedClients}`,
    );

    // 发送当前连接数
    client.emit('stats', { connectedClients: this.connectedClients });
  }

  handleDisconnect(client: Socket) {
    this.connectedClients--;
    this.logger.log(
      `Client disconnected: ${client.id}, total: ${this.connectedClients}`,
    );
  }

  /**
   * 广播交易事件到所有连接的客户端
   */
  broadcastTradeEvent(event: string, data: unknown): void {
    this.server.emit('trade', {
      event,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 广播订单状态变更
   */
  broadcastOrderUpdate(orderId: string, status: string, data?: unknown): void {
    this.server.emit('order:update', {
      orderId,
      status,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 广播新任务
   */
  broadcastNewTask(task: unknown): void {
    this.server.emit('task:new', { task, timestamp: new Date().toISOString() });
  }

  /**
   * 广播新竞价
   */
  broadcastNewBid(taskId: string, bid: unknown): void {
    this.server.emit('bid:new', {
      taskId,
      bid,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 广播系统统计信息
   */
  broadcastStats(stats: Record<string, unknown>): void {
    this.server.emit('stats', {
      ...stats,
      timestamp: new Date().toISOString(),
    });
  }
}
