import { Injectable } from '@nestjs/common';
import { DueAction, TimeoutRegistry } from './timeout-registry';

/**
 * 平台侧自动超时任务键（对接指南 §3.2.6）。
 * 归 Marketplace 的 6 项超时由平台计时并触发默认动作，另一方消费结果事件。
 */
export const TIMEOUT_KEY = {
  /** 席位满 72h 雇主未决策 → 自动全部驳回 */
  SEAT_FULL_DECISION: 'seat_full_decision',
  /** 任务有效期到期未选标 → 已过期 */
  TASK_EXPIRY: 'task_expiry',
  /** Spec 提交后 7 天雇主未确认 → 自动取消 Project */
  SPEC_EMPLOYER_CONFIRM: 'spec_employer_confirm',
  /** 交付物提交后 14 天未验收 → 自动验收 */
  DELIVERY_AUTO_ACCEPT: 'delivery_auto_accept',
  /** 修订协商 2 天窗口无操作 → 默认选项 C（接受当前） */
  NEGOTIATION_DEFAULT_C: 'negotiation_default_c',
  /** Spec 驳回 5 次 → 触发协商取消（事件计数，占位） */
  SPEC_REJECTION_LIMIT: 'spec_rejection_limit',
  /** 签约阶段总超时 30 天 → 触发协商取消 */
  SIGNING_TOTAL: 'signing_total',
} as const;

export type TimeoutKey = (typeof TIMEOUT_KEY)[keyof typeof TIMEOUT_KEY];

/**
 * 超时扫描器：内部维护时间注册表；由 cron（5min）驱动 scanDue，
 * 到期项交给对应阶段处理器执行默认动作。测试可注入 now 即时验证。
 */
@Injectable()
export class TimeoutScannerService {
  private readonly registry = new TimeoutRegistry();

  /** 登记到期动作（同 key 覆盖，幂等） */
  register(key: TimeoutKey | string, dueAt: number, meta?: unknown): void {
    this.registry.set(key, dueAt, meta);
  }

  cancel(key: TimeoutKey | string): boolean {
    return this.registry.delete(key);
  }

  get(key: TimeoutKey | string): DueAction | undefined {
    return this.registry.get(key);
  }

  has(key: TimeoutKey | string): boolean {
    return this.registry.has(key);
  }

  /** 扫描并摘除到期项 */
  scanDue(now: number): DueAction[] {
    return this.registry.scanDue(now);
  }
}