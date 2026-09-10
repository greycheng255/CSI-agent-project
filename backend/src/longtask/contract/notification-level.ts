/**
 * 通知分级与聚合（PRD §7.9）M 侧契约口径：
 *   info（知晓即可）/ reminder（SLA 内行动）/ urgent（立即行动，否则触发自动后果）
 * 同一 Project 同类型事件 1h 内多次触发 → 聚合为一条。
 * 交付渠道（站内/邮件/短信/App Push）由平台基础设施版块提供，本模块只负责分级与聚合口径。
 */
export const NOTIFICATION_LEVELS = ['info', 'reminder', 'urgent'] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

export const EVENT_NOTIFICATION_LEVEL: Record<string, NotificationLevel> = {
  'opportunity.pushed': 'info',
  'bid.won': 'info',
  'bid.lost': 'info',
  'bid.batch_rejected': 'info',
  'task.employer_reply': 'reminder',
  'spec.confirmed': 'info',
  'spec.rejected': 'reminder',
  'spec.timeout': 'urgent',
  'delivery.accepted': 'info',
  'delivery.auto_accepted': 'reminder',
  'delivery.rejected': 'reminder',
  'delivery.revision_requested': 'reminder',
  'revision.negotiation_started': 'reminder',
  'revision.negotiation_decided': 'info',
  'revision.negotiation_auto_accepted': 'urgent',
  'spec_change.requested': 'reminder',
  'spec_change.employer_confirmed': 'info',
  'spec_change.employer_rejected': 'reminder',
  'project.cancel_request': 'urgent',
  'project.cancel_counter_response': 'reminder',
  'project.cancel_resolution': 'reminder',
  'settlement.completed': 'info',
  'settlement.appeal_period_closed': 'info',
  'project.dispute_raised': 'urgent',
  'dispute.arbitration_started': 'reminder',
  'dispute.arbitration_result': 'urgent',
};

export const DEFAULT_AGGREGATION_WINDOW_MS = 60 * 60 * 1000;

export function levelForEvent(eventType: string): NotificationLevel {
  return EVENT_NOTIFICATION_LEVEL[eventType] ?? 'info';
}

export interface NotificationLike {
  eventType: string;
  at: Date | string;
}

export interface AggregatedNotification {
  eventType: string;
  level: NotificationLevel;
  count: number;
  firstAt: string;
  lastAt: string;
}

/** 按 (eventType) 聚合窗口内事件；不同 eventType 不合并，窗口按时间序滑动于首条 */
export function aggregateNotifications(
  events: NotificationLike[],
  windowMs = DEFAULT_AGGREGATION_WINDOW_MS,
): AggregatedNotification[] {
  const sorted = [...events]
    .map((e) => ({ ...e, ms: new Date(e.at).getTime() }))
    .filter((e) => Number.isFinite(e.ms))
    .sort((a, b) => a.ms - b.ms);

  const buckets: AggregatedNotification[] = [];
  for (const event of sorted) {
    const bucket = buckets.find(
      (b) => b.eventType === event.eventType && event.ms - new Date(b.firstAt).getTime() <= windowMs,
    );
    if (bucket) {
      bucket.count += 1;
      bucket.lastAt = new Date(event.ms).toISOString();
      continue;
    }
    buckets.push({
      eventType: event.eventType,
      level: levelForEvent(event.eventType),
      count: 1,
      firstAt: new Date(event.ms).toISOString(),
      lastAt: new Date(event.ms).toISOString(),
    });
  }
  return buckets;
}
