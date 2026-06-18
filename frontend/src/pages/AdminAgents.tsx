import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, ShieldCheck, Slash, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  approveAgent,
  forceDisableAgent,
  listAdminAgents,
  rejectAgent,
} from '../api/agentsApi';
import { AgentSkillTags } from '../components/agents/AgentSkillTags';
import { AgentStatusBadge } from '../components/agents/AgentStatusBadge';
import { useAuthStore } from '../store/authStore';
import type { Agent, AgentApprovalStatus } from '../types/agent';

const tabs: Array<{ key: 'all' | AgentApprovalStatus; label: string }> = [
  { key: 'pending_review', label: '待审核' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已驳回' },
  { key: 'disabled', label: '已禁用' },
  { key: 'all', label: '全部' },
];

export default function AdminAgents() {
  const { admin } = useAuthStore();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | AgentApprovalStatus>('pending_review');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actingId, setActingId] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAgents(await listAdminAgents());
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取审核列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!admin) {
      navigate('/login');
      return;
    }
    fetchAgents();
  }, [admin, fetchAgents, navigate]);

  const filtered = useMemo(() => {
    if (activeTab === 'all') return agents;
    return agents.filter((agent) => agent.approvalStatus === activeTab);
  }, [activeTab, agents]);

  const countOf = (key: 'all' | AgentApprovalStatus) =>
    key === 'all' ? agents.length : agents.filter((agent) => agent.approvalStatus === key).length;

  const runAction = async (agent: Agent, action: 'approve' | 'reject' | 'disable') => {
    let comment = '';
    if (action === 'reject') {
      comment = window.prompt('请输入驳回原因') || '';
      if (!comment.trim()) return;
    }
    if (action === 'approve' && !window.confirm(`确认通过 ${agent.name} 的审核吗？`)) return;
    if (action === 'disable' && !window.confirm(`确认禁用 ${agent.name} 吗？`)) return;

    setActingId(agent.id);
    setError('');
    try {
      if (action === 'approve') await approveAgent(agent.id, 'approved from admin page');
      if (action === 'reject') await rejectAgent(agent.id, comment);
      if (action === 'disable') await forceDisableAgent(agent.id);
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-100">
          <ShieldCheck className="h-6 w-6 text-yellow-300" />
          Agent 审核管理
        </h1>
        <p className="mt-2 text-sm text-gray-500">审核用户提交的平台托管和外部自托管 Agent。</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded border px-3 py-1.5 text-sm ${
              activeTab === tab.key
                ? 'border-yellow-500 bg-yellow-500/10 text-yellow-300'
                : 'border-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label} ({countOf(tab.key)})
          </button>
        ))}
      </div>

      {error && <div className="rounded border border-red-500/30 bg-red-500/10 p-4 text-red-300">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          正在读取审核列表
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-800 p-12 text-center text-gray-500">
          当前状态下暂无 Agent。
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((agent) => (
            <article key={agent.id} className="rounded-lg border border-gray-800 bg-[#0a0a0a] p-5">
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h2 className="mr-2 text-lg font-bold text-gray-100">{agent.name}</h2>
                    <AgentStatusBadge type="approval" value={agent.approvalStatus} />
                    <AgentStatusBadge type="runtime" value={agent.runtimeStatus} />
                    <AgentStatusBadge type="agentType" value={agent.agentType} />
                  </div>
                  <p className="mb-3 text-sm text-gray-400">{agent.description || '暂无描述'}</p>
                  <div className="mb-3 grid gap-2 text-xs text-gray-500 md:grid-cols-2">
                    <div>Owner: {agent.owner?.phone || agent.owner?.displayName || agent.owner?.id || '-'}</div>
                    <div>Created: {agent.createdAt ? new Date(agent.createdAt).toLocaleString() : '-'}</div>
                    <div className="break-all">Endpoint: {agent.endpointUrl || '-'}</div>
                    <div className="break-all">Card: {agent.cardUrl || agent.cards?.[0]?.source || '-'}</div>
                  </div>
                  <AgentSkillTags agent={agent} limit={16} />
                </div>

                <div className="flex flex-wrap gap-2 lg:w-72 lg:justify-end">
                  <button
                    onClick={() => runAction(agent, 'approve')}
                    disabled={actingId === agent.id || agent.approvalStatus === 'approved'}
                    className="inline-flex items-center gap-1 rounded border border-green-500/40 px-3 py-2 text-sm text-green-300 hover:bg-green-500/10 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    通过
                  </button>
                  <button
                    onClick={() => runAction(agent, 'reject')}
                    disabled={actingId === agent.id || agent.approvalStatus === 'rejected'}
                    className="inline-flex items-center gap-1 rounded border border-red-500/40 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    <XCircle className="h-4 w-4" />
                    驳回
                  </button>
                  <button
                    onClick={() => runAction(agent, 'disable')}
                    disabled={actingId === agent.id || agent.approvalStatus === 'disabled'}
                    className="inline-flex items-center gap-1 rounded border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                  >
                    <Slash className="h-4 w-4" />
                    禁用
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
