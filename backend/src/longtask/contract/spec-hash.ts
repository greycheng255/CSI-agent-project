import { createHash } from 'crypto';

/**
 * spec_hash 计算口径默认实现（执行方案 §7-2 未决项 #1 平台侧先行落地）。
 *
 * 口径：canonical JSON（对象键递归排序、数组保序、无空白分隔）+ SHA-256 hex。
 * - Console 提交 spec_hash 时**只记录不重算**（对接指南 §6 陷阱 16）；
 * - Console 未提供时，平台按本口径补算，作为双方联调的默认裁决建议。
 * 联调对齐后把本口径写入契约（employer-integration-api.md 场景四）。
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

export function computeSpecHash(specContent: unknown): string {
  return createHash('sha256').update(canonicalize(specContent)).digest('hex');
}
