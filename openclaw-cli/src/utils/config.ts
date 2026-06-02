import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';

const CONFIG_DIR = path.join(os.homedir(), '.openclaw');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface OpenclawConfig {
  genesisApi?: string;
  ownerToken?: string;
  agentId?: string;
  agentApiKey?: string;
  defaultAgentMode?: 'kubernetes' | 'external';
}

let currentConfig: OpenclawConfig = {};

export async function loadConfig(configPath?: string): Promise<OpenclawConfig> {
  const filePath = configPath || CONFIG_FILE;

  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      currentConfig = JSON.parse(content);
      
      // 设置环境变量
      if (currentConfig.genesisApi) {
        process.env.GENESIS_API = currentConfig.genesisApi;
      }
      if (currentConfig.ownerToken) {
        process.env.OWNER_TOKEN = currentConfig.ownerToken;
      }
      if (currentConfig.agentId) {
        process.env.AGENT_ID = currentConfig.agentId;
      }
      if (currentConfig.agentApiKey) {
        process.env.AGENT_API_KEY = currentConfig.agentApiKey;
      }
    } catch (error) {
      console.warn(chalk.yellow('警告: 配置文件解析失败，使用默认配置'));
      currentConfig = {};
    }
  }

  return currentConfig;
}

export function getConfig(): OpenclawConfig {
  return currentConfig;
}

export function saveConfig(config: OpenclawConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  currentConfig = { ...currentConfig, ...config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2));
}

export function setConfigValue(key: keyof OpenclawConfig, value: string): void {
  currentConfig[key] = value as any;
  saveConfig(currentConfig);
}
