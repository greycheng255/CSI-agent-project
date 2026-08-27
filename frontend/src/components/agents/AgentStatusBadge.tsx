import type { AgentApprovalStatus, AgentRuntimeStatus, AgentType } from '../../types/agent';

const approvalMap: Record<string, { label: string; className: string }> = {
  pending_review: {
    label: '待审核',
    className: 'border-[#f3d79a] bg-[var(--state-warning-surface)] text-[var(--state-warning)]',
  },
  approved: {
    label: '已通过',
    className: 'border-[#bde9c9] bg-[var(--state-success-surface)] text-[var(--state-success-text)]',
  },
  rejected: {
    label: '已驳回',
    className: 'border-[#ffc6c1] bg-[var(--state-error-surface)] text-[var(--state-error)]',
  },
  disabled: {
    label: '已禁用',
    className: 'border-[color:var(--border)] bg-[var(--background-100)] text-[var(--text-600)]',
  },
};

const runtimeMap: Record<string, { label: string; className: string }> = {
  online: {
    label: '在线',
    className: 'border-[#bde9c9] bg-[var(--state-success-surface)] text-[var(--state-success-text)]',
  },
  degraded: {
    label: '降级',
    className: 'border-[#f3d79a] bg-[var(--state-warning-surface)] text-[var(--state-warning)]',
  },
  offline: {
    label: '离线',
    className: 'border-[color:var(--border)] bg-[var(--background-100)] text-[var(--text-600)]',
  },
  timeout: {
    label: '超时',
    className: 'border-[#ffc6c1] bg-[var(--state-error-surface)] text-[var(--state-error)]',
  },
  unknown: {
    label: '未知',
    className: 'border-[color:var(--border)] bg-[var(--background-100)] text-[var(--text-500)]',
  },
};

const typeMap: Record<string, string> = {
  'platform-managed': '平台默认',
  platform_managed: '平台默认',
  platform: '平台默认',
  'self-hosted': '外部自托管',
  self_hosted: '外部自托管',
  external: '外部自托管',
};

export function AgentStatusBadge({
  type,
  value,
}: {
  type: 'approval' | 'runtime' | 'agentType';
  value?: AgentApprovalStatus | AgentRuntimeStatus | AgentType | string | null;
}) {
  if (!value) return null;

  if (type === 'agentType') {
    return (
      <span className="inline-flex items-center rounded-full border border-[var(--brand-200)] bg-[var(--brand-50)] px-2.5 py-1 text-xs text-[var(--brand-700)]">
        {typeMap[value] || value}
      </span>
    );
  }

  const item = type === 'approval' ? approvalMap[value] : runtimeMap[value];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${
        item?.className || 'border-[color:var(--border)] bg-[var(--background-100)] text-[var(--text-500)]'
      }`}
    >
      {item?.label || value}
    </span>
  );
}
