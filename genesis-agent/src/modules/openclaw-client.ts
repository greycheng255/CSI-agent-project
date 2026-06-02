import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { Task, TaskAnalysis, OpenclawAnalysisResult, OpenclawQuoteRequest, OpenclawQuoteResult } from '../types';
import { getLogger } from '../utils/logger';

const logger = getLogger();

/**
 * Openclaw 客户端配置
 */
interface OpenclawClientConfig {
  baseUrl: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Openclaw 客户端
 * 负责与 Openclaw 服务通信，进行任务深度分析和报价生成
 */
export class OpenclawClient {
  private client: AxiosInstance;
  private config: OpenclawClientConfig;

  constructor(config: OpenclawClientConfig) {
    this.config = {
      timeout: 30000,
      maxRetries: 3,
      retryDelay: 1000,
      ...config,
    };

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 请求拦截器 - 添加日志
    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`Openclaw Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('Openclaw Request interceptor error', { error });
        return Promise.reject(error);
      }
    );

    // 响应拦截器 - 添加日志
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`Openclaw Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        logger.error('Openclaw Response error', {
          url: error.config?.url,
          status: error.response?.status,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * 分析任务 - 发送任务给 Openclaw 进行深度分析
   * @param task 任务对象
   * @param initialAnalysis 初步分析结果
   * @returns Openclaw 深度分析结果
   */
  async analyzeTask(task: Task, initialAnalysis: TaskAnalysis): Promise<OpenclawAnalysisResult> {
    const request = {
      taskId: task.id,
      title: task.title,
      description: task.description,
      acceptanceCriteria: task.acceptanceCriteria,
      budgetCny: task.budgetCny,
      expectedDeliveryAt: task.expectedDeliveryAt,
      tags: task.tags,
      initialAnalysis: {
        confidence: initialAnalysis.confidence,
        estimatedComplexity: initialAnalysis.estimatedComplexity,
        timeEstimate: initialAnalysis.timeEstimate,
        requiredSkills: initialAnalysis.requiredSkills,
      },
    };

    try {
      logger.info('Sending task to Openclaw for analysis', {
        taskId: task.id,
        title: task.title,
      });

      const response = await this.requestWithRetry<OpenclawAnalysisResult>({
        method: 'POST',
        url: '/api/v1/analyze',
        data: request,
      });

      logger.info('Openclaw analysis completed', {
        taskId: task.id,
        complexity: response.complexity,
        estimatedHours: response.estimatedHours,
        confidence: response.confidence,
      });

      return response;
    } catch (error) {
      logger.error('Openclaw analysis failed', {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 生成报价 - 基于 Openclaw 分析结果生成智能报价
   * @param request 报价请求
   * @returns 报价结果
   */
  async generateQuote(request: OpenclawQuoteRequest): Promise<OpenclawQuoteResult> {
    try {
      logger.info('Requesting quote from Openclaw', {
        taskId: request.taskId,
        marketRate: request.marketRate,
      });

      const response = await this.requestWithRetry<OpenclawQuoteResult>({
        method: 'POST',
        url: '/api/v1/quote',
        data: request,
      });

      logger.info('Openclaw quote generated', {
        taskId: request.taskId,
        suggestedPrice: response.suggestedPrice,
        confidence: response.confidence,
      });

      return response;
    } catch (error) {
      logger.error('Openclaw quote generation failed', {
        taskId: request.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 获取市场参考价格
   * @param taskType 任务类型
   * @returns 市场参考价格范围
   */
  async getMarketRate(taskType: string): Promise<{ min: number; max: number; avg: number }> {
    try {
      const response = await this.requestWithRetry<{ min: number; max: number; avg: number }>({
        method: 'GET',
        url: `/api/v1/market-rate?type=${encodeURIComponent(taskType)}`,
      });

      return response;
    } catch (error) {
      logger.warn('Failed to get market rate from Openclaw, using default', {
        taskType,
        error: error instanceof Error ? error.message : String(error),
      });
      // 返回默认值
      return { min: 50, max: 500, avg: 150 };
    }
  }

  /**
   * 健康检查
   * @returns 是否健康
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  /**
   * 带重试的请求
   */
  private async requestWithRetry<T>(
    config: AxiosRequestConfig,
    retries: number = this.config.maxRetries ?? 3
  ): Promise<T> {
    try {
      const response = await this.client.request<T>(config);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;

      // 检查是否需要重试
      if (retries > 0 && this.shouldRetry(axiosError)) {
        const delay = (this.config.retryDelay ?? 1000) * Math.pow(2, (this.config.maxRetries ?? 3) - retries);
        logger.warn(`Openclaw request failed, retrying in ${delay}ms... (${retries} retries left)`, {
          url: config.url,
          error: axiosError.message,
        });

        await this.sleep(delay);
        return this.requestWithRetry(config, retries - 1);
      }

      throw error;
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

    // 服务器错误
    const status = error.response.status;
    return status >= 500 || status === 429; // 429 Too Many Requests
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
