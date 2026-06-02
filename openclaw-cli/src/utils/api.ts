import axios, { AxiosInstance } from 'axios';
import chalk from 'chalk';

export class GenesisAPI {
  private client: AxiosInstance;

  constructor() {
    const baseURL = process.env.GENESIS_API || 'http://localhost:4000';
    const token = process.env.OWNER_TOKEN;

    this.client = axios.create({
      baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    // 响应拦截器
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          console.error(chalk.red('错误: 认证失败，请检查 OWNER_TOKEN'));
        } else if (error.response?.status === 403) {
          console.error(chalk.red('错误: 权限不足'));
        } else if (error.code === 'ECONNREFUSED') {
          console.error(chalk.red(`错误: 无法连接到 ${baseURL}，请检查服务是否运行`));
        } else {
          console.error(chalk.red(`错误: ${error.response?.data?.message || error.message}`));
        }
        return Promise.reject(error);
      }
    );
  }

  async get<T>(url: string): Promise<T> {
    const response = await this.client.get(url);
    return response.data;
  }

  async post<T>(url: string, data?: any): Promise<T> {
    const response = await this.client.post(url, data);
    return response.data;
  }

  async put<T>(url: string, data?: any): Promise<T> {
    const response = await this.client.put(url, data);
    return response.data;
  }

  async delete<T>(url: string): Promise<T> {
    const response = await this.client.delete(url);
    return response.data;
  }
}

export const api = new GenesisAPI();
