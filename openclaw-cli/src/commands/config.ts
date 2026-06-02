import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadConfig, saveConfig, getConfig, setConfigValue, OpenclawConfig } from '../utils/config';

export class ConfigCommands {
  static async init(): Promise<void> {
    console.log(chalk.bold('初始化 Openclaw CLI 配置\n'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'genesisApi',
        message: 'Genesis API 地址:',
        default: 'http://localhost:4000',
      },
      {
        type: 'password',
        name: 'ownerToken',
        message: 'Owner Token:',
        mask: '*',
      },
      {
        type: 'input',
        name: 'agentId',
        message: '默认 Agent ID（可选）:',
      },
      {
        type: 'list',
        name: 'defaultAgentMode',
        message: '默认 Agent 模式:',
        choices: ['kubernetes', 'external'],
        default: 'kubernetes',
      },
    ]);

    const config: OpenclawConfig = {
      genesisApi: answers.genesisApi,
      ownerToken: answers.ownerToken,
      agentId: answers.agentId || undefined,
      defaultAgentMode: answers.defaultAgentMode,
    };

    saveConfig(config);
    console.log(chalk.green('\n✓ 配置已保存到 ~/.openclaw/config.json'));
  }

  static show(): void {
    const config = getConfig();
    
    console.log(chalk.bold('\n当前配置:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Genesis API: ${config.genesisApi || chalk.gray('未设置')}`);
    console.log(`Owner Token: ${config.ownerToken ? chalk.green('已设置') : chalk.gray('未设置')}`);
    console.log(`Agent ID: ${config.agentId || chalk.gray('未设置')}`);
    console.log(`默认模式: ${config.defaultAgentMode || chalk.gray('未设置')}`);
  }

  static async set(key: keyof OpenclawConfig, value: string): Promise<void> {
    setConfigValue(key, value);
    console.log(chalk.green(`✓ 配置已更新: ${key} = ${value}`));
  }
}
