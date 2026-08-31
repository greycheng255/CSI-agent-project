/**
 * Console 侧 17 个 Webhook 端点路径（M→C，平台调用 Console）。
 * base URL 由 CONSOLE_BASE_URL 环境变量配置（联调时指向 Console 测试 K8s）。
 */
export const CONSOLE_WEBHOOK = {
  opportunityPushed: '/v1/webhooks/opportunity/pushed',
  bidResult: '/v1/webhooks/bid/result',
  employerReply: '/v1/webhooks/task/employer-reply',
  specEmployerAction: '/v1/webhooks/spec/employer-action',
  deliveryEmployerReview: '/v1/webhooks/delivery/employer-review',
  revisionNegotiationAction: '/v1/webhooks/revision/negotiation-action',
  specChangeRequest: '/v1/webhooks/spec-change/request',
  specChangeEmployerConfirmation:
    '/v1/webhooks/spec-change/employer-confirmation',
  projectCancelRequest: '/v1/webhooks/project/cancel-request',
  projectCancelCounterResponse: '/v1/webhooks/project/cancel-counter-response',
  projectCancelResolution: '/v1/webhooks/project/cancel-resolution',
  settlementResult: '/v1/webhooks/settlement/result',
  projectDisputeRaised: '/v1/webhooks/project/dispute-raised',
  settlementAppealPeriodClosed: '/v1/webhooks/settlement/appeal-period-closed',
  disputeArbitrationStarted: '/v1/webhooks/dispute/arbitration-started',
  disputeArbitrationResult: '/v1/webhooks/dispute/arbitration-result',
} as const;

export type ConsoleWebhookKey = keyof typeof CONSOLE_WEBHOOK;

/** 拼接 Console Webhook 完整 URL */
export function consoleWebhookUrl(path: string): string {
  const base = (
    process.env.CONSOLE_BASE_URL ?? 'http://console.internal'
  ).replace(/\/+$/, '');
  return `${base}${path}`;
}