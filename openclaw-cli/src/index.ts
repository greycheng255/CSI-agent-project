#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { AgentCommands } from './commands/agent';
import { TaskCommands } from './commands/task';
import { ConfigCommands } from './commands/config';
import { StatusCommands } from './commands/status';
import { getConfig, loadConfig } from './utils/config';

const program = new Command();

program
  .name('openclaw')
  .description('Openclaw CLI - Genesis Agent 管理工具')
  .version('1.0.0')
  .option('-c, --config <path>', '配置文件路径')
  .option('-u, --url <url>', 'Genesis API 地址')
  .option('-t, --token <token>', 'Owner Token')
  .option('-a, --agent-id <id>', 'Agent ID')
  .hook('preAction', async (thisCommand) => {
    const opts = thisCommand.opts();
    await loadConfig(opts.config);
    
    // 命令行参数覆盖配置文件
    if (opts.url) process.env.GENESIS_API = opts.url;
    if (opts.token) process.env.OWNER_TOKEN = opts.token;
    if (opts.agentId) process.env.AGENT_ID = opts.agentId;
  });

// Agent 管理命令
const agentCmd = program
  .command('agent')
  .description('Agent 管理');

agentCmd
  .command('list')
  .description('列出所有 Agent')
  .action(async () => {
    await AgentCommands.list();
  });

agentCmd
  .command('status')
  .description('查看 Agent 状态')
  .option('-i, --id <id>', 'Agent ID（默认使用配置文件中的）')
  .action(async (options) => {
    await AgentCommands.status(options.id);
  });

agentCmd
  .command('health')
  .description('执行 Agent 健康检查')
  .option('-i, --id <id>', 'Agent ID')
  .action(async (options) => {
    await AgentCommands.health(options.id);
  });

agentCmd
  .command('create')
  .description('创建新 Agent')
  .requiredOption('-n, --name <name>', 'Agent 名称')
  .option('-d, --description <desc>', 'Agent 描述')
  .option('-w, --webhook <url>', 'Webhook URL')
  .option('-s, --skills <skills>', '技能列表（逗号分隔）')
  .action(async (options) => {
    await AgentCommands.create(options);
  });

agentCmd
  .command('update-skills')
  .description('更新 Agent 技能')
  .requiredOption('-i, --id <id>', 'Agent ID')
  .requiredOption('-s, --skills <skills>', '技能列表（逗号分隔）')
  .action(async (options) => {
    await AgentCommands.updateSkills(options.id, options.skills);
  });

agentCmd
  .command('delete')
  .description('删除 Agent')
  .requiredOption('-i, --id <id>', 'Agent ID')
  .action(async (options) => {
    await AgentCommands.delete(options.id);
  });

// 任务管理命令
const taskCmd = program
  .command('task')
  .description('任务管理');

taskCmd
  .command('list')
  .description('列出任务大厅中的任务')
  .option('-s, --status <status>', '任务状态', 'OPEN')
  .option('-l, --limit <limit>', '数量限制', '20')
  .action(async (options) => {
    await TaskCommands.list(options.status, parseInt(options.limit));
  });

taskCmd
  .command('get')
  .description('获取任务详情')
  .requiredOption('-i, --id <id>', '任务 ID')
  .action(async (options) => {
    await TaskCommands.get(options.id);
  });

taskCmd
  .command('create')
  .description('发布新任务')
  .requiredOption('-t, --title <title>', '任务标题')
  .requiredOption('-d, --description <desc>', '任务描述')
  .requiredOption('-p, --price <price>', '预算价格（元）')
  .option('--type <type>', '任务类型', 'FEATURE')
  .action(async (options) => {
    await TaskCommands.create(options);
  });

// 状态监控命令
const statusCmd = program
  .command('status')
  .description('系统状态监控');

statusCmd
  .command('overview')
  .description('查看系统整体状态')
  .action(async () => {
    await StatusCommands.overview();
  });

statusCmd
  .command('metrics')
  .description('查看业务指标')
  .option('-d, --days <days>', '时间范围（天）', '7')
  .action(async (options) => {
    await StatusCommands.metrics(parseInt(options.days));
  });

// 配置命令
const configCmd = program
  .command('config')
  .description('配置管理');

configCmd
  .command('init')
  .description('初始化配置文件')
  .action(async () => {
    await ConfigCommands.init();
  });

configCmd
  .command('show')
  .description('显示当前配置')
  .action(() => {
    ConfigCommands.show();
  });

configCmd
  .command('set')
  .description('设置配置项')
  .requiredOption('-k, --key <key>', '配置键')
  .requiredOption('-v, --value <value>', '配置值')
  .action(async (options) => {
    await ConfigCommands.set(options.key, options.value);
  });

// 运行
program.parse();
