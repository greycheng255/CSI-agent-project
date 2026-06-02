import chalk from 'chalk';
import ora from 'ora';
import { api } from '../utils/api';

export class TaskCommands {
  static async list(status: string = 'OPEN', limit: number = 20): Promise<void> {
    const spinner = ora('获取任务列表...').start();
    try {
      const tasks = await api.get<any[]>(`/api/v1/tasks/market?status=${status}&limit=${limit}`);
      spinner.stop();

      if (!tasks || tasks.length === 0) {
        console.log(chalk.yellow('暂无任务'));
        return;
      }

      console.log(chalk.bold(`\n任务列表 (${tasks.length} 个):`));
      console.log(chalk.gray('─'.repeat(80)));
      
      tasks.forEach((task) => {
        const statusColor = task.status === 'OPEN' ? chalk.green : chalk.yellow;
        console.log(`${statusColor(task.status)}  ${chalk.bold(task.title || '无标题')}`);
        console.log(`   ID: ${chalk.cyan(task.id)}`);
        console.log(`   预算: ${chalk.green('¥' + (task.budgetCny || 0))}`);
        console.log(`   类型: ${task.type || '未指定'}`);
        console.log(`   创建时间: ${task.createdAt ? new Date(task.createdAt).toLocaleString() : '未知'}`);
        console.log(chalk.gray('─'.repeat(80)));
      });
    } catch {
      spinner.stop();
    }
  }

  static async get(taskId: string): Promise<void> {
    const spinner = ora('获取任务详情...').start();
    try {
      const task = await api.get<any>(`/api/v1/tasks/${taskId}`);
      spinner.stop();

      console.log(chalk.bold('\n任务详情:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`标题: ${chalk.bold(task.title)}`);
      console.log(`ID: ${chalk.cyan(task.id)}`);
      console.log(`状态: ${task.status === 'OPEN' ? chalk.green('开放中') : chalk.yellow(task.status)}`);
      console.log(`预算: ${chalk.green('¥' + (task.budgetCny || 0))}`);
      console.log(`类型: ${task.type || '未指定'}`);
      console.log(`描述: ${task.description || '无'}`);
      console.log(`创建时间: ${task.createdAt ? new Date(task.createdAt).toLocaleString() : '未知'}`);
    } catch {
      spinner.stop();
    }
  }

  static async create(options: {
    title: string;
    description: string;
    price: string;
    type?: string;
  }): Promise<void> {
    const spinner = ora('创建任务...').start();
    try {
      const task = await api.post<any>('/api/v1/tasks', {
        title: options.title,
        description: options.description,
        budgetCny: parseFloat(options.price),
        type: options.type || 'FEATURE',
      });
      spinner.stop();

      console.log(chalk.green('\n✓ 任务创建成功'));
      console.log(`ID: ${chalk.cyan(task.id)}`);
      console.log(`标题: ${chalk.bold(task.title)}`);
    } catch {
      spinner.stop();
    }
  }
}
