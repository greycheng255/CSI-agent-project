import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { AgentConfig, Skill, QuoteStrategy } from '../types';
import { getLogger } from '../utils/logger';

const logger = getLogger();

/**
 * 配置管理器
 * 负责加载和管理应用配置
 */
export class ConfigManager {
  private config: AgentConfig | null = null;
  private configPath: string;

  constructor(configPath: string = './config') {
    this.configPath = configPath;
  }

  /**
   * 加载配置
   */
  async load(): Promise<AgentConfig> {
    try {
      // 1. 从环境变量加载基础配置
      const envConfig = this.loadFromEnv();

      // 2. 从 YAML 文件加载技能配置
      const skills = this.loadSkills();

      // 3. 加载报价策略
      const quoteStrategy = this.loadQuoteStrategy();

      // 4. 合并配置
      this.config = {
        ...envConfig,
        skills,
        quoteStrategy,
      };

      logger.info('Configuration loaded successfully', {
        agentId: this.config.agentId,
        genesisApi: this.config.genesisApi,
        skillCount: skills.length,
      });

      return this.config;
    } catch (error) {
      logger.error('Failed to load configuration', { error });
      throw error;
    }
  }

  /**
   * 从环境变量加载配置
   */
  private loadFromEnv(): Omit<AgentConfig, 'skills' | 'quoteStrategy'> {
    const requiredEnvVars = ['AGENT_ID', 'OWNER_TOKEN', 'GENESIS_API'];
    const missing = requiredEnvVars.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    return {
      agentId: process.env.AGENT_ID!,
      ownerToken: process.env.OWNER_TOKEN!,
      agentApiKey: process.env.AGENT_API_KEY,
      genesisApi: process.env.GENESIS_API!,
      openclawUrl: process.env.OPENCLAW_URL || 'http://172.17.0.14:18080',
      scanInterval: parseInt(process.env.SCAN_INTERVAL || '30000', 10),
      heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10),
    };
  }

  /**
   * 从 YAML 文件加载技能配置
   */
  private loadSkills(): Skill[] {
    const skillsPath = path.join(this.configPath, 'skills.yaml');

    if (!fs.existsSync(skillsPath)) {
      logger.warn(`Skills config not found at ${skillsPath}, using empty skills`);
      return [];
    }

    try {
      const content = fs.readFileSync(skillsPath, 'utf-8');
      const parsed = yaml.load(content) as { skills: Skill[] };
      return parsed.skills || [];
    } catch (error) {
      logger.error('Failed to parse skills.yaml', { error });
      return [];
    }
  }

  /**
   * 加载报价策略
   */
  private loadQuoteStrategy(): QuoteStrategy {
    return {
      minProfitMargin: parseFloat(process.env.MIN_PROFIT_MARGIN || '0.2'),
      maxDiscountRate: parseFloat(process.env.MAX_DISCOUNT_RATE || '0.3'),
      competitiveAdjustment: process.env.COMPETITIVE_ADJUSTMENT !== 'false',
      urgencyBonus: parseFloat(process.env.URGENCY_BONUS || '0.1'),
      marketRate: parseFloat(process.env.MARKET_RATE || '50'),
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): AgentConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    return this.config;
  }

  /**
   * 重新加载配置
   */
  async reload(): Promise<AgentConfig> {
    logger.info('Reloading configuration...');
    return this.load();
  }
}

/**
 * 创建默认配置管理器实例
   */
export function createConfigManager(configPath?: string): ConfigManager {
  return new ConfigManager(configPath);
}

export default ConfigManager;
