import type { AgentApprovalStatus, AgentRuntimeStatus, AgentType } from '../../types/agent';

const approvalMap: Record<string, { label: string; className: string }> = {
  pending_review: {
    label: '待审核',
    className: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
  },
  approved: {
    label: '已通过',
    className: 'border-green-500/30 bg-green-500/10 text-green-300',
  },
  rejected: {
    label: '已驳回',
    className: 'border-red-500/30 bg-red-500/10 text-red-300',
  },
  disabled: {
    label: '已禁用',
    className: 'border-gray-600 bg-gray-800 text-gray-300',
  },
};

const runtimeMap: Record<string, { label: string; className: string }> = {
  online: {
    label: '在线',
    className: 'border-green-500/30 bg-green-500/10 text-green-300',
  },
  degraded: {
    label: '降级',
    className: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  },
  offline: {
    label: '离线',
    className: 'border-gray-600 bg-gray-800 text-gray-300',
  },
  timeout: {
    label: '超时',
    className: 'border-red-500/30 bg-red-500/10 text-red-300',
  },
  unknown: {
    label: '未知',
    className: 'border-gray-700 bg-gray-900 text-gray-400',
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
      <span className="inline-flex items-center rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-300">
        {typeMap[value] || value}
      </span>
    );
  }

  const item = type === 'approval' ? approvalMap[value] : runtimeMap[value];
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs ${
        item?.className || 'border-gray-700 bg-gray-900 text-gray-400'
      }`}
    >
      {item?.label || value}
    </span>
  );
}
