import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { SelectionService } from '../marketplace-bids/selection.service';
import { MarketplaceTasksService } from '../marketplace-tasks/marketplace-tasks.service';
import { SpecContractService } from '../marketplace-orders/spec-contract.service';
import { DeliveryContractService } from '../marketplace-orders/delivery-contract.service';
import { RevisionNegotiationService } from '../marketplace-orders/revision-negotiation.service';
import { SettlementsService } from '../settlements/settlements.service';
import { DisputesService } from '../disputes/disputes.service';
import { TimeoutScannerService } from './timeout-scanner.service';

const SCAN_INTERVAL_MS =
  Number(process.env.LONGTASK_DEADLINE_SCAN_INTERVAL_MS) || 5 * 60 * 1000;
/** 会话级 advisory lock 键：保证多实例（4000 生产 + 4001 开发共库）同一时刻仅一个实例扫描 */
const ADVISORY_LOCK_KEY = 728193401;

/**
 * 统一超时调度器（集成指南 §3.2.6「各管各的」+ TS §10.8 deadline scanner）：
 * 每 5min 串起 Marketplace 归属的全部自动超时动作，把「代码」变成「能力」：
 *   - 席位满 72h → 自动全部驳回（selection.scanSeatFullTimeouts）
 *   - Marketplace Task 有效期到 → expired（tasks.scanExpired）
 *   - Spec 7 天未确认 → spec.timeout + 任务重开（spec.scanSpecTimeouts）
 *   - 交付 14 天未验收 → delivery.auto_accepted（delivery.scanAutoAccept）
 *   - 修订协商 2 天 → 默认 C（revision.scanNegotiationTimeouts）
 *   - 售后申诉期 7 天关闭 → settlement.appeal_period_closed（settlements.scanAppealPeriodClosed）
 *   - 纠纷举证 3 天窗口 → disputes.scanEvidenceDeadlines
 *   - 5/9/13 天催办点位计数（催办消息由 Console 经 #9 推送，M 侧仅记录）
 *   - 内存登记表到期项摘除（timeoutScanner.scanDue，DB 扫描为权威口径）
 *
 * 可用 LONGTASK_DEADLINE_SCANNER_ENABLED=false 整体关闭（如灰度/单实例维护窗口）。
 */
@Injectable()
export class DeadlineScannerCron {
  private readonly logger = new Logger(DeadlineScannerCron.name);
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly selectionService: SelectionService,
    private readonly tasksService: MarketplaceTasksService,
    private readonly specContractService: SpecContractService,
    private readonly deliveryContractService: DeliveryContractService,
    private readonly revisionNegotiationService: RevisionNegotiationService,
    private readonly settlementsService: SettlementsService,
    private readonly disputesService: DisputesService,
    private readonly timeoutScanner: TimeoutScannerService,
  ) {}

  @Interval(SCAN_INTERVAL_MS)
  async scanDue(): Promise<void> {
    if (process.env.LONGTASK_DEADLINE_SCANNER_ENABLED === 'false') return;
    if (this.running) return;
    this.running = true;

    const now = new Date();
    const runner = this.dataSource.createQueryRunner();
    let locked = false;
    try {
      await runner.connect();
      const rows: Array<{ locked: boolean }> = await runner.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [ADVISORY_LOCK_KEY],
      );
      locked = rows[0]?.locked === true;
      if (!locked) {
        // 另一实例正在扫描：本轮直接跳过
        return;
      }

      const result = {
        seatFull: await this.selectionService.scanSeatFullTimeouts(now),
        taskExpired: await this.tasksService.scanExpired(now),
        specTimeout: await this.specContractService.scanSpecTimeouts(now),
        autoAccept: await this.deliveryContractService.scanAutoAccept(now),
        reminders: await this.deliveryContractService.countDueReminders(
          now.getTime(),
        ),
        negotiation: await this.revisionNegotiationService.scanNegotiationTimeouts(
          now,
        ),
        appealClosed: await this.settlementsService.scanAppealPeriodClosed(now),
        evidenceDeadline: await this.disputesService.scanEvidenceDeadlines(now),
        registeredDue: this.timeoutScanner.scanDue(now.getTime()).length,
      };

      if (Object.values(result).some((count) => count > 0)) {
        this.logger.log(`deadline scan: ${JSON.stringify(result)}`);
      }
    } catch (err) {
      this.logger.error(`deadline scan tick failed: ${String(err)}`);
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
