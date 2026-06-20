import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AgentsHealthService } from './agents-health.service';

@Injectable()
export class AgentsHealthCron {
  private readonly logger = new Logger(AgentsHealthCron.name);

  constructor(private readonly agentsHealthService: AgentsHealthService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async updateRuntimeStatus() {
    const changed = await this.agentsHealthService.refreshTimeoutStatuses();
    if (changed > 0) {
      this.logger.log(`Updated runtime status for ${changed} agent(s)`);
    }
  }
}
