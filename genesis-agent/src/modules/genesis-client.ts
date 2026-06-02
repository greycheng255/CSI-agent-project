import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
import {
  Task,
  Bid,
  TaskStatus,
  ApiResponse,
  PaginatedResponse,
  GenesisAPIError,
  HeartbeatStatus,
} from '../types';
import { getLogger } from '../utils/logger';

const logger = getLogger();

/**
 * Genesis API 客户端配置
 */
interface GenesisClientConfig {
  baseUrl: string;
  agentId: string;
  ownerToken: string;
  agentApiKey?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * 获取任务列表参数
 */
interface GetTasksParams {
  status?: TaskStatus;
  limit?: number;
  offset?: number;
  excludeIds?: string[];
}

/**
 * 提交报价参数
 */
interface SubmitBidParams {
  taskId: string;
  priceCny: number;
  planSummary: string;
  detailedPlan?: string;
  confidence?: number;
  pricingModel?: string;
  pricingMeta?: Record<string, any>;
  expiresAt?: string;
}

/**
 * Genesis API 客户端
 * 封装与 Genesis 平台的所有 API 交互
 */
export class GenesisClient {
  private client: AxiosInstance;
  private config: GenesisClientConfig;

  constructor(config: GenesisClientConfig) {
    this.config = {
      timeout: 10000,
      maxRetries: 3,
      retryDelay: 1000,
      ...config,
    };

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.ownerToken}`,
      },
    });

    // 请求拦截器 - 添加日志
    this.client.interceptors.request.use(
      (request) => {
        logger.debug(`API Request: ${request.method?.toUpperCase()} ${request.url}`, {
          url: request.url,
          method: request.method,
        });
        return request;
      },
      (error) => {
        logger.error('Request interceptor error', { error });
        return Promise.reject(error);
      }
    );

    // 响应拦截器 - 添加日志
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        logger.error('API Response error', {
          url: error.config?.url,
          status: error.response?.status,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * 带重试的 API 请求
   */
  private async requestWithRetry<T>(
    config: AxiosRequestConfig,
    retries: number = this.config.maxRetries ?? 3
  ): Promise<T> {
    try {
      const response = await this.client.request<ApiResponse<T> | T>(config);
      // 处理两种响应格式：{ data: T } 或直接返回 T
      const responseData = response.data as Record<string, unknown>;
      if (responseData && 'data' in responseData) {
        return (response.data as ApiResponse<T>).data;
      }
      return response.data as T;
    } catch (error) {
      const axiosError = error as AxiosError;

      // 检查是否需要重试
      if (retries > 0 && this.shouldRetry(axiosError)) {
        const maxRetries = this.config.maxRetries ?? 3;
        const retryDelay = this.config.retryDelay ?? 1000;
        const delay = retryDelay * Math.pow(2, maxRetries - retries);
        logger.warn(`Request failed, retrying in ${delay}ms... (${retries} retries left)`, {
          url: config.url,
          error: axiosError.message,
        });

        await this.sleep(delay);
        return this.requestWithRetry(config, retries - 1);
      }

      // 抛出业务错误
      throw this.createError(axiosError);
    }
  }

  /**
   * 判断是否应该重试
   */
  private shouldRetry(error: AxiosError): boolean {
    // 网络错误或超时
    if (!error.response) {
      return true;
    }

    // DNS 解析错误 (EAI_AGAIN, ENOTFOUND 等)
    if (error.code && ['EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT'].includes(error.code)) {
      return true;
    }

    // 服务器错误 (5xx)
    if (error.response.status >= 500) {
      return true;
    }

    // 限流 (429)
    if (error.response.status === 429) {
      return true;
    }

    return false;
  }

  /**
   * 创建业务错误
   */
  private createError(error: AxiosError): GenesisAPIError {
    const statusCode = error.response?.status;
    const message = (error.response?.data as any)?.message || error.message;

    let code = 'UNKNOWN_ERROR';
    if (statusCode === 401) code = 'UNAUTHORIZED';
    else if (statusCode === 403) code = 'FORBIDDEN';
    else if (statusCode === 404) code = 'NOT_FOUND';
    else if (statusCode === 429) code = 'RATE_LIMITED';
    else if (statusCode && statusCode >= 500) code = 'SERVER_ERROR';

    return new GenesisAPIError(code, message, statusCode, {
      url: error.config?.url,
      method: error.config?.method,
    });
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 更新 Agent ID（用于动态更新）
   */
  updateAgentId(agentId: string): void {
    this.config.agentId = agentId;
    logger.info('GenesisClient agentId updated', { agentId });
  }

  /**
   * 发送心跳
   */
  async sendHeartbeat(): Promise<HeartbeatStatus> {
    return this.requestWithRetry<HeartbeatStatus>({
      method: 'POST',
      url: `/api/v1/owner/agents/${this.config.agentId}/heartbeat`,
    });
  }

  /**
   * 获取 Agent 状态
   */
  async getAgentStatus(): Promise<HeartbeatStatus> {
    return this.requestWithRetry<HeartbeatStatus>({
      method: 'GET',
      url: `/api/v1/owner/agents/${this.config.agentId}/status`,
    });
  }

  /**
   * 获取任务列表
   */
  async getTasks(params: GetTasksParams = {}): Promise<Task[]> {
    const { status = 'OPEN', limit = 20, offset = 0, excludeIds } = params;

    const queryParams = new URLSearchParams();
    queryParams.append('status', status);
    queryParams.append('limit', limit.toString());
    queryParams.append('offset', offset.toString());
    if (excludeIds && excludeIds.length > 0) {
      queryParams.append('excludeIds', excludeIds.join(','));
    }

    const response = await this.requestWithRetry<Task[]>({
      method: 'GET',
      url: `/api/v1/tasks/market?${queryParams.toString()}`,
    });

    return response;
  }

  /**
   * 获取任务详情
   */
  async getTask(taskId: string): Promise<Task> {
    const response = await this.requestWithRetry<any>({
      method: 'GET',
      url: `/api/v1/tasks/${taskId}`,
    });
    // 后端返回格式是 { id, title, description, ... }
    return response;
  }

  /**
   * 获取任务的报价列表
   */
  async getTaskBids(taskId: string): Promise<Bid[]> {
    const response = await this.requestWithRetry<Bid[]>({
      method: 'GET',
      url: `/api/v1/agent/bids/task/${taskId}`,
    });

    return response;
  }

  /**
   * 提交报价
   */
  async submitBid(params: SubmitBidParams): Promise<Bid> {
    const { taskId, priceCny, planSummary, confidence, pricingModel, pricingMeta, expiresAt } = params;

    // 使用 AGENT_API_KEY 进行认证（如果配置了）
    const headers: Record<string, string> = {};
    if (this.config.agentApiKey) {
      headers['Authorization'] = `Bearer ${this.config.agentApiKey}`;
    }

    return this.requestWithRetry<Bid>({
      method: 'POST',
      url: '/api/v1/agent/bids',
      data: {
        taskId,
        priceCny,
        planSummary,
        confidence,
        pricingModel,
        pricingMeta,
        expiresAt,
      },
      headers,
    });
  }

  /**
   * 更新报价（根据 taskId）
   */
  async updateBid(params: SubmitBidParams): Promise<Bid> {
    const { taskId, priceCny, planSummary, confidence, pricingModel, pricingMeta, expiresAt } = params;

    // 使用 AGENT_API_KEY 进行认证（如果配置了）
    const headers: Record<string, string> = {};
    if (this.config.agentApiKey) {
      headers['Authorization'] = `Bearer ${this.config.agentApiKey}`;
    }

    return this.requestWithRetry<Bid>({
      method: 'PUT',
      url: `/api/v1/agent/bids/task/${taskId}`,
      data: {
        priceCny,
        planSummary,
        confidence,
        pricingModel,
        pricingMeta,
        expiresAt,
      },
      headers,
    });
  }

  /**
   * 获取报价状态
   */
  async getBidStatus(bidId: string): Promise<Bid> {
    return this.requestWithRetry<Bid>({
      method: 'GET',
      url: `/api/v1/agent/bids/${bidId}`,
    });
  }

  /**
   * 获取报价详情（别名）
   */
  async getBid(bidId: string): Promise<Bid> {
    return this.getBidStatus(bidId);
  }

  /**
   * 提交交付物
   */
  async submitDelivery(
    orderId: string,
    userId: string,
    delivery: { deliverySummary: string; deliveryUrl: string }
  ): Promise<void> {
    return this.requestWithRetry<void>({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/deliver`,
      data: {
        ...delivery,
        userId,
      },
    });
  }

  /**
   * 更新任务状态
   */
  async updateTaskStatus(taskId: string, status: string): Promise<any> {
    return this.requestWithRetry({
      method: 'PATCH',
      url: `/api/v1/agent/tasks/${taskId}/status`,
      data: { status },
    });
  }

  /**
   * 获取任务验收状态
   */
  async getTaskAcceptanceStatus(taskId: string): Promise<any> {
    return this.requestWithRetry({
      method: 'GET',
      url: `/api/v1/agent/tasks/${taskId}/acceptance`,
    });
  }

  /**
   * 获取订单详情
   */
  async getOrder(orderId: string): Promise<any> {
    const response = await this.requestWithRetry<any>({
      method: 'GET',
      url: `/api/v1/orders/${orderId}`,
    });
    // 后端返回格式是 { success: true, data: {...} }
    return response.data || response;
  }

  /**
   * 获取客户历史记录
   */
  async getClientHistory(clientId: string): Promise<any> {
    return this.requestWithRetry<any>({
      method: 'GET',
      url: `/api/v1/clients/${clientId}/history`,
    });
  }

  /**
   * 获取任务报价数量
   */
  async getTaskBidCount(taskId: string): Promise<number> {
    const response = await this.requestWithRetry<any>({
      method: 'GET',
      url: `/api/v1/tasks/${taskId}/bid-count`,
    });
    return response.count || 0;
  }

  /**
   * 注册或更新 Agent（用于 Pod 重启后保持 AGENT_ID）
   */
  async upsertAgent(params: {
    externalId: string;
    name: string;
    webhookUrl: string;
    podName?: string;
    agentMode?: 'kubernetes' | 'external';
    skills?: string[];
    description?: string;
  }): Promise<{ id: string; externalId: string; agentMode: string }> {
    // 使用 AGENT_API_KEY 进行认证
    const headers: Record<string, string> = {};
    if (this.config.agentApiKey) {
      headers['Authorization'] = `Bearer ${this.config.agentApiKey}`;
    }

    return this.requestWithRetry({
      method: 'POST',
      url: '/api/v1/owner/agents/upsert',
      data: params,
      headers,
    });
  }

  /**
   * 检查后端健康状态
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * 报告 Agent 重启
   */
  async reportRestart(component: string): Promise<void> {
    try {
      await this.client.post(`/api/v1/owner/agents/${this.config.agentId}/restart`, {
        component,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.warn('Failed to report restart', { component, error });
    }
  }
}

export default GenesisClient;
