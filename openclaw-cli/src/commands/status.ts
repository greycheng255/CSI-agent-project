import chalk from 'chalk';
import ora from 'ora';
import { api } from '../utils/api';

export class StatusCommands {
  static async overview(): Promise<void> {
    const spinner = ora('获取系统状态...').start();
    try {
      // 获取 Agent 状态
      const agentId = process.env.AGENT_ID;
      let agentStatus: any = null;
      if (agentId) {
        try {
          agentStatus = await api.get(`/api/v1/owner/agents/${agentId}/status`);
        } catch {
          // 忽略错误
        }
      }

      // 获取任务统计
      let tasks: any[] = [];
      try {
        tasks = await api.get('/api/v1/tasks/market?status=OPEN&limit=1');
      } catch {
        // 忽略错误
      }

      spinner.stop();

      console.log(chalk.bold('\n系统状态概览:'));
      console.log(chalk.gray('─'.repeat(50)));

      if (agentStatus) {
        const status = agentStatus.status === 'ONLINE' ? chalk.green('在线') : chalk.red('离线');
        console.log(`Agent 状态: ${status}`);
        console.log(`最后心跳: ${agentStatus.lastHeartbeatAt ? new Date(agentStatus.lastHeartbeatAt).toLocaleString() : '从未'}`);
      } else {
        console.log(`Agent 状态: ${chalk.gray('未配置')}`);
      }

      console.log(`开放任务: ${chalk.green(tasks.length > 0 ? '有' : '无')}`);
      console.log(`Genesis API: ${process.env.GENESIS_API || chalk.gray('未配置')}`);
    } catch {
      spinner.stop();
    }
  }

  static async metrics(days: number = 7): Promise<void> {
    const spinner = ora('获取业务指标...').start();
    try {
      // 获取 Agent 的 bids
      const agentId = process.env.AGENT_ID;
      if (!agentId) {
        spinner.stop();
        console.log(chalk.yellow('未配置 Agent ID'));
        return;
      }

      const bids = await api.get<any[]>(`/api/v1/agent/bids/agent/${agentId}`);
      spinner.stop();

      console.log(chalk.bold(`\n业务指标 (最近 ${days} 天):`));
      console.log(chalk.gray('─'.repeat(50)));

      if (!bids || bids.length === 0) {
        console.log(chalk.yellow('暂无报价记录'));
        return;
      }

      const totalBids = bids.length;
      const totalAmount = bids.reduce((sum: number, bid: any) => sum + (bid.priceCny || 0), 0);
      const avgPrice = totalAmount / totalBids;

      console.log(`总报价数: ${chalk.bold(totalBids)}`);
      console.log(`总报价金额: ${chalk.green('¥' + totalAmount.toFixed(2))}`);
      console.log(`平均报价: ${chalk.green('¥' + avgPrice.toFixed(2))}`);

      // 按日期分组
      const byDate = bids.reduce((acc: Record<string, number>, bid: any) => {
        const date = bid.createdAt ? new Date(bid.createdAt).toLocaleDateString() : '未知';
        acc[date] = (acc[date] || 0) + 1;
        return acc;
      }, {});

      console.log(chalk.bold('\n按日期分布:'));
      Object.entries(byDate).forEach(([date, count]) => {
        console.log(`  ${date}: ${chalk.bold(count as number)} 个报价`);
      });
    } catch {
      spinner.stop();
    }
  }
}
