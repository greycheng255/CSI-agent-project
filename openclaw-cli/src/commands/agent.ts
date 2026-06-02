import chalk from 'chalk';
import ora from 'ora';
import { api } from '../utils/api';

export class AgentCommands {
  static async list(): Promise<void> {
    const spinner = ora('获取 Agent 列表...').start();
    try {
      const agents = await api.get<any[]>('/api/v1/owner/agents/my');
      spinner.stop();

      if (!agents || agents.length === 0) {
        console.log(chalk.yellow('暂无 Agent'));
        return;
      }

      console.log(chalk.bold('\nAgent 列表:'));
      console.log(chalk.gray('─'.repeat(80)));
      
      agents.forEach((agent) => {
        const status = agent.status === 'ONLINE' 
          ? chalk.green('● 在线') 
          : chalk.gray('● 离线');
        
        console.log(`${status}  ${chalk.bold(agent.name)}`);
        console.log(`   ID: ${chalk.cyan(agent.id)}`);
        console.log(`   模式: ${agent.agentMode === 'kubernetes' ? 'Kubernetes' : '外部'}`);
        console.log(`   Openclaw: ${agent.openclawStatus === 'CONNECTED' ? chalk.green('已连接') : chalk.yellow('未连接')}`);
        console.log(`   Skills: ${Array.isArray(agent.skills) ? agent.skills.join(', ') : '无'}`);
        console.log(chalk.gray('─'.repeat(80)));
      });
    } catch {
      spinner.stop();
    }
  }

  static async status(agentId?: string): Promise<void> {
    const id = agentId || process.env.AGENT_ID;
    if (!id) {
      console.error(chalk.red('错误: 未指定 Agent ID'));
      return;
    }

    const spinner = ora('获取 Agent 状态...').start();
    try {
      const status = await api.get<any>(`/api/v1/owner/agents/${id}/status`);
      spinner.stop();

      console.log(chalk.bold('\nAgent 状态:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`状态: ${status.status === 'ONLINE' ? chalk.green('在线') : chalk.red('离线')}`);
      console.log(`最后心跳: ${status.lastHeartbeatAt ? new Date(status.lastHeartbeatAt).toLocaleString() : '从未'}`);
      console.log(`心跳间隔: ${status.heartbeatIntervalMs}ms`);
    } catch {
      spinner.stop();
    }
  }

  static async health(agentId?: string): Promise<void> {
    const id = agentId || process.env.AGENT_ID;
    if (!id) {
      console.error(chalk.red('错误: 未指定 Agent ID'));
      return;
    }

    const spinner = ora('执行健康检查...').start();
    try {
      const result = await api.post<any>(`/api/v1/owner/agents/${id}/health-check`);
      spinner.stop();

      console.log(chalk.bold('\n健康检查结果:'));
      console.log(chalk.gray('─'.repeat(50)));
      
      const status = result.status === 'ONLINE' ? chalk.green('通过') : chalk.red('失败');
      console.log(`Agent 状态: ${status}`);
      
      const openclawStatus = result.openclawStatus === 'CONNECTED' ? chalk.green('通过') : chalk.red('失败');
      console.log(`Openclaw: ${openclawStatus}`);
      
      if (result.checks) {
        console.log(chalk.bold('\n检查项:'));
        Object.entries(result.checks).forEach(([key, value]) => {
          const icon = value ? chalk.green('✓') : chalk.red('✗');
          const name = {
            podRunning: 'Pod 运行',
            heartbeatValid: '心跳正常',
            openclawReachable: 'Openclaw 可达',
            configurationValid: '配置有效',
          }[key] || key;
          console.log(`  ${icon} ${name}`);
        });
      }

      if (result.errors && result.errors.length > 0) {
        console.log(chalk.red('\n检测到的问题:'));
        result.errors.forEach((error: string) => {
          console.log(`  ${chalk.red('•')} ${error}`);
        });
      }
    } catch {
      spinner.stop();
    }
  }

  static async create(options: {
    name: string;
    description?: string;
    webhook?: string;
    skills?: string;
  }): Promise<void> {
    const spinner = ora('创建 Agent...').start();
    try {
      const agent = await api.post<any>('/api/v1/owner/agents', {
        name: options.name,
        description: options.description,
        webhookUrl: options.webhook,
        skills: options.skills ? options.skills.split(',').map((s: string) => s.trim()) : [],
      });
      spinner.stop();

      console.log(chalk.green('\n✓ Agent 创建成功'));
      console.log(`ID: ${chalk.cyan(agent.id)}`);
      console.log(`名称: ${chalk.bold(agent.name)}`);
    } catch {
      spinner.stop();
    }
  }

  static async updateSkills(agentId: string, skills: string): Promise<void> {
    const spinner = ora('更新技能...').start();
    try {
      await api.post(`/api/v1/owner/agents/${agentId}/skills`, {
        skills: skills.split(',').map((s: string) => s.trim()),
      });
      spinner.stop();
      console.log(chalk.green('✓ 技能更新成功'));
    } catch {
      spinner.stop();
    }
  }

  static async delete(agentId: string): Promise<void> {
    const spinner = ora('删除 Agent...').start();
    try {
      await api.delete(`/api/v1/owner/agents/${agentId}`);
      spinner.stop();
      console.log(chalk.green('✓ Agent 删除成功'));
    } catch {
      spinner.stop();
    }
  }
}
