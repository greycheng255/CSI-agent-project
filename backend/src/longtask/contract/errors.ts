/**
 * 长任务跨版块契约错误码与可重试性映射（对接指南 §3.1）。
 * AUTH 前缀不可重试；RATE_LIMIT ／ UPSTREAM ／ INTERNAL 前缀可重试。
 */
export const CONTRACT_ERROR_CODE = {
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_HMAC_SIGNATURE_MISMATCH: 'AUTH_HMAC_SIGNATURE_MISMATCH',
  AUTH_TIMESTAMP_EXPIRED: 'AUTH_TIMESTAMP_EXPIRED',
  VALIDATION_INVALID_PAYLOAD: 'VALIDATION_INVALID_PAYLOAD',
  VALIDATION_GATE_NOT_PASSED: 'VALIDATION_GATE_NOT_PASSED',
  NOT_FOUND_TASK: 'NOT_FOUND_TASK',
  NOT_FOUND_ORDER: 'NOT_FOUND_ORDER',
  NOT_FOUND_WORKSPACE: 'NOT_FOUND_WORKSPACE',
  CONFLICT_SEAT_FULL: 'CONFLICT_SEAT_FULL',
  CONFLICT_SPEC_VERSION: 'CONFLICT_SPEC_VERSION_CONFLICT',
  CONFLICT_DUPLICATE: 'CONFLICT_DUPLICATE',
  CONFLICT_SLUG: 'CONFLICT_WORKSPACE_SLUG',
  CONFLICT_SETTLEMENT_ALREADY_TRIGGERED: 'CONFLICT_SETTLEMENT_ALREADY_TRIGGERED',
  STATE_INVALID_TRANSITION: 'STATE_INVALID_TRANSITION',
  STATE_PROJECT_NOT_DELIVERABLE: 'STATE_PROJECT_NOT_DELIVERABLE',
  STATE_COUNTER_PROPOSAL_UNSUPPORTED: 'COUNTER_PROPOSAL_UNSUPPORTED',
  RATE_LIMIT_TOO_MANY: 'RATE_LIMIT_TOO_MANY',
  UPSTREAM_UNREACHABLE: 'UPSTREAM_UNREACHABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ContractErrorCode =
  (typeof CONTRACT_ERROR_CODE)[keyof typeof CONTRACT_ERROR_CODE];

/** 可重试错误码判定：RATE_LIMIT ／ UPSTREAM ／ INTERNAL 前缀可重试，其余（含 AUTH 前缀）不可重试 */
export function isRetryableErrorCode(code: string): boolean {
  return ['RATE_LIMIT_', 'UPSTREAM_', 'INTERNAL_'].some((p) =>
    code.startsWith(p),
  );
}

/** 跨版块契约错误（RFC 7807 兼容），由 Rfc7807Filter 统一渲染 */
export class ContractError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: ContractErrorCode | string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ContractError';
  }
}