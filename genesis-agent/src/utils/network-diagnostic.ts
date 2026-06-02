import { getLogger } from './logger';

const logger = getLogger();

/**
 * 网络诊断工具
 * 用于检测和诊断与 Genesis 平台的连接问题
 */
export class NetworkDiagnostic {
  private genesisApi: string;
  private timeout: number;

  constructor(genesisApi: string, timeout: number = 5000) {
    this.genesisApi = genesisApi;
    this.timeout = timeout;
  }

  /**
   * 运行完整的网络诊断
   */
  async runDiagnostics(): Promise<{
    dnsResolvable: boolean;
    tcpConnectable: boolean;
    httpReachable: boolean;
    latencyMs: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let dnsResolvable = false;
    let tcpConnectable = false;
    let httpReachable = false;
    let latencyMs = -1;

    logger.info('Starting network diagnostics...', { genesisApi: this.genesisApi });

    // 1. DNS 解析测试
    try {
      const url = new URL(this.genesisApi);
      const dnsResult = await this.testDNSResolution(url.hostname);
      dnsResolvable = dnsResult.success;
      if (!dnsResult.success) {
        errors.push(`DNS解析失败: ${dnsResult.error}`);
      }
    } catch (error) {
      errors.push(`URL解析失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 2. HTTP 连通性测试
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.genesisApi}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      latencyMs = Date.now() - startTime;

      if (response.ok) {
        httpReachable = true;
        tcpConnectable = true;
      } else {
        errors.push(`HTTP状态异常: ${response.status}`);
      }
    } catch (error) {
      latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('fetch failed') || errorMessage.includes('ECONNREFUSED')) {
        errors.push('TCP连接被拒绝，服务可能未启动');
      } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('EAI_AGAIN')) {
        errors.push('DNS解析失败，请检查网络配置');
      } else if (errorMessage.includes('timeout') || errorMessage.includes('abort')) {
        errors.push('连接超时，网络可能不稳定');
      } else {
        errors.push(`HTTP请求失败: ${errorMessage}`);
      }
    }

    const result = {
      dnsResolvable,
      tcpConnectable,
      httpReachable,
      latencyMs,
      errors,
    };

    logger.info('Network diagnostics completed', result);
    return result;
  }

  /**
   * 测试 DNS 解析
   */
  private async testDNSResolution(hostname: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 使用 Node.js 的 dns 模块
      const { lookup } = await import('dns');
      const { promisify } = await import('util');
      const lookupAsync = promisify(lookup);

      await lookupAsync(hostname);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取网络状态摘要
   */
  getStatusSummary(diagnosticResult: {
    dnsResolvable: boolean;
    tcpConnectable: boolean;
    httpReachable: boolean;
    latencyMs: number;
    errors: string[];
  }): string {
    const parts: string[] = [];

    if (diagnosticResult.httpReachable) {
      parts.push(`✅ 网络连接正常 (延迟: ${diagnosticResult.latencyMs}ms)`);
    } else {
      parts.push('❌ 网络连接异常');
      if (!diagnosticResult.dnsResolvable) {
        parts.push('  - DNS无法解析，请检查 /etc/hosts 或 DNS配置');
      }
      if (!diagnosticResult.tcpConnectable) {
        parts.push('  - TCP连接失败，请检查服务是否运行');
      }
      if (diagnosticResult.errors.length > 0) {
        parts.push(`  - 错误: ${diagnosticResult.errors.join(', ')}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * 建议修复方案
   */
  getRecommendations(diagnosticResult: {
    dnsResolvable: boolean;
    tcpConnectable: boolean;
    httpReachable: boolean;
    errors: string[];
  }): string[] {
    const recommendations: string[] = [];

    if (!diagnosticResult.dnsResolvable) {
      recommendations.push('1. 添加 hosts 记录: echo "127.0.0.1 genesis-backend.genesis.svc.cluster.local" | sudo tee -a /etc/hosts');
      recommendations.push('2. 或使用 IP 地址代替域名配置 GENESIS_API');
      recommendations.push('3. 检查 DNS 配置: cat /etc/resolv.conf');
    }

    if (!diagnosticResult.tcpConnectable && diagnosticResult.dnsResolvable) {
      recommendations.push('1. 确认 Genesis Backend 服务已启动');
      recommendations.push('2. 检查防火墙设置');
      recommendations.push('3. 确认端口 4000 可访问');
    }

    if (!diagnosticResult.httpReachable) {
      recommendations.push('1. 检查 .env 文件中的 GENESIS_API 配置');
      recommendations.push('2. 尝试使用本地地址: GENESIS_API=http://localhost:4000');
      recommendations.push('3. 查看 Genesis Backend 日志');
    }

    return recommendations;
  }
}

export default NetworkDiagnostic;
