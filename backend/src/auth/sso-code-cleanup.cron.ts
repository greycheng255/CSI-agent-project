import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SsoAuthorizationCode } from './entities/sso-authorization-code.entity';

/**
 * 定时清理过期/已使用的 SSO 授权码，防止表无限膨胀
 */
@Injectable()
export class SsoCodeCleanupCron {
  private readonly logger = new Logger(SsoCodeCleanupCron.name);

  constructor(
    @InjectRepository(SsoAuthorizationCode)
    private authCodesRepository: Repository<SsoAuthorizationCode>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredCodes() {
    // 清理已过期超过 1 天的授权码（已使用的 created_at 早于过期时间，同样被覆盖）
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await this.authCodesRepository.delete({
      expiresAt: LessThan(cutoff),
    });
    if ((result.affected ?? 0) > 0) {
      this.logger.log(`Cleaned up ${result.affected} expired SSO authorization code(s)`);
    }
  }
}
