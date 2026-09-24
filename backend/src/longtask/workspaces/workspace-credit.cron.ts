import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { WorkspaceCreditService } from './workspace-credit.service';

const RECOMPUTE_INTERVAL_MS =
  Number(process.env.LONGTASK_CREDIT_RECOMPUTE_INTERVAL_MS) || 10 * 60 * 1000;
/** 启动后首次重算延迟：避开启动期迁移/连接池预热 */
const BOOTSTRAP_DELAY_MS = 10_000;
/** 会话级 advisory lock 键：多实例（4000 生产 + 4001 开发共库）同一时刻仅一个实例重算 */
const ADVISORY_LOCK_KEY = 728193402;

/**
 * 信用数据自动重算（PRD §5.6.7「平台自动生成」的落地机制）：
 * 每 10min 依据订单/交付/纠纷真实数据重算全部 workspace 的四项信用指标并写回投影表。
 * 可用 LONGTASK_CREDIT_RECOMPUTE_ENABLED=false 整体关闭（灰度/维护窗口）。
 */
@Injectable()
export class WorkspaceCreditCron implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkspaceCreditCron.name);
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly creditService: WorkspaceCreditService,
  ) {}

  onApplicationBootstrap(): void {
    const timer = setTimeout(() => {
      void this.recompute('bootstrap');
    }, BOOTSTRAP_DELAY_MS);
    timer.unref?.();
  }

  @Interval(RECOMPUTE_INTERVAL_MS)
  async recompute(trigger: string = 'interval'): Promise<void> {
    if (process.env.LONGTASK_CREDIT_RECOMPUTE_ENABLED === 'false') return;
    if (this.running) return;
    this.running = true;

    const runner = this.dataSource.createQueryRunner();
    let locked = false;
    try {
      await runner.connect();
      const rows: Array<{ locked: boolean }> = await runner.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [ADVISORY_LOCK_KEY],
      );
      locked = rows[0]?.locked === true;
      if (!locked) return; // 另一实例正在重算

      const changed = await this.creditService.recomputeAll();
      if (changed > 0) {
        this.logger.log(`workspace credit recompute (${trigger}): ${changed} changed`);
      }
    } catch (err) {
      this.logger.error(`workspace credit recompute failed: ${String(err)}`);
    } finally {
      if (locked) {
        await runner
          .query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY])
          .catch(() => undefined);
      }
      await runner.release().catch(() => undefined);
      this.running = false;
    }
  }
}