/**
 * 平台订阅权益错误码（TS 附录 B.6，DR-12）：
 * 全部 4xx 业务态拒绝（不可重试），不得落入 UPSTREAM_/INTERNAL_ 可重试族。
 */
export const ENTITLEMENT_ERROR = {
  PLAN_NOT_FOUND: 'ENTITLEMENT_PLAN_NOT_FOUND',
  LIMIT_REACHED: 'ENTITLEMENT_LIMIT_REACHED',
  CATALOG_DENIED: 'ENTITLEMENT_CATALOG_DENIED',
  QUOTA_EXHAUSTED: 'ENTITLEMENT_QUOTA_EXHAUSTED',
} as const;

import { ContractError } from '../longtask/contract/errors';

export function planNotFound(orgId: string): ContractError {
  return new ContractError(
    404,
    ENTITLEMENT_ERROR.PLAN_NOT_FOUND,
    `org has no active subscription: ${orgId}`,
  );
}

export function limitReached(orgId: string): ContractError {
  return new ContractError(
    403,
    ENTITLEMENT_ERROR.LIMIT_REACHED,
    `cloud runtime instance limit reached for org: ${orgId}`,
  );
}

export function catalogDenied(value: string): ContractError {
  return new ContractError(
    403,
    ENTITLEMENT_ERROR.CATALOG_DENIED,
    `not in plan catalog: ${value}`,
  );
}

export function quotaExhausted(orgId: string): ContractError {
  return new ContractError(
    402,
    ENTITLEMENT_ERROR.QUOTA_EXHAUSTED,
    `llm quota exhausted for org: ${orgId}`,
  );
}
