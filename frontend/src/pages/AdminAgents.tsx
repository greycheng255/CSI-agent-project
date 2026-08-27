import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, Inbox, Loader2, RefreshCw, ShieldCheck, Slash, XCircle } from 'lucide-react';
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
import { WorkbenchPageHeader, WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';

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
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={ShieldCheck}
        eyebrow="Agent 审核"
        title="Agent 入驻审核"
        description="核验平台托管与外部自托管 Agent 的资料、执行端配置和能力标签。"
        actions={<button type="button" onClick={() => void fetchAgents()} disabled={loading} className="btn-cs btn-ghost-dark btn-sm disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新列表</button>}
      />

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-[var(--background-100)] p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`min-h-10 shrink-0 rounded-lg px-4 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-[var(--brand-700)] shadow-sm'
                : 'text-[var(--text-500)] hover:text-[var(--text-800)]'
            }`}
          >
            {tab.label} <span className="ml-1 text-xs text-[var(--text-400)]">{countOf(tab.key)}</span>
          </button>
        ))}
      </div>

      {error && agents.length > 0 && <div className="flex items-center gap-2 rounded-xl border border-[color:var(--state-error)] bg-[var(--state-error-surface)] p-4 text-sm text-[var(--state-error)]"><CircleAlert className="h-4 w-4" />{error}</div>}

      {loading ? (
        <div className="flex min-h-64 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-white text-sm text-[var(--text-500)]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-[var(--brand-500)]" />
          正在读取审核列表
        </div>
      ) : error && agents.length === 0 ? (
        <WorkbenchStatePanel icon={CircleAlert} title="审核列表暂时无法加载" description={error} tone="error" action={<button type="button" onClick={() => void fetchAgents()} className="btn-cs btn-primary btn-sm">重新加载</button>} />
      ) : filtered.length === 0 ? (
        <WorkbenchStatePanel icon={Inbox} title="当前分类暂无 Agent" description="切换其他审核状态，或等待新的 Agent 提交入驻申请。" />
      ) : (
        <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
          <div className="border-b border-[color:var(--border)] px-5 py-4"><h2 className="font-semibold text-[var(--text-800)]">审核队列</h2><p className="mt-1 text-xs text-[var(--text-500)]">当前分类共 {filtered.length} 个 Agent</p></div>
          <div className="divide-y divide-[color:var(--border)]">
          {filtered.map((agent) => (
            <article key={agent.id} className="p-5 transition-colors hover:bg-[var(--background-100)]">
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h2 className="mr-2 text-base font-semibold text-[var(--text-900)]">{agent.name}</h2>
                    <AgentStatusBadge type="approval" value={agent.approvalStatus} />
                    <AgentStatusBadge type="runtime" value={agent.runtimeStatus} />
                    <AgentStatusBadge type="agentType" value={agent.agentType} />
                  </div>
                  <p className="mb-3 text-sm leading-6 text-[var(--text-500)]">{agent.description || '暂无描述'}</p>
                  <dl className="mb-3 grid gap-x-6 gap-y-2 rounded-xl bg-[var(--background-100)] p-4 text-xs md:grid-cols-2">
                    <div><dt className="text-[var(--text-400)]">所有者</dt><dd className="mt-0.5 text-[var(--text-700)]">{agent.owner?.phone || agent.owner?.displayName || agent.owner?.id || '-'}</dd></div>
                    <div><dt className="text-[var(--text-400)]">提交时间</dt><dd className="mt-0.5 text-[var(--text-700)]">{agent.createdAt ? new Date(agent.createdAt).toLocaleString() : '-'}</dd></div>
                    <div className="break-all"><dt className="text-[var(--text-400)]">执行端</dt><dd className="mt-0.5 text-[var(--text-700)]">{agent.endpointUrl || '-'}</dd></div>
                    <div className="break-all"><dt className="text-[var(--text-400)]">Agent Card</dt><dd className="mt-0.5 text-[var(--text-700)]">{agent.cardUrl || agent.cards?.[0]?.source || '-'}</dd></div>
                  </dl>
                  <AgentSkillTags agent={agent} limit={16} variant="light" />
                </div>

                <div className="flex flex-wrap gap-2 lg:w-72 lg:justify-end">
                  <button
                    onClick={() => runAction(agent, 'approve')}
                    disabled={actingId === agent.id || agent.approvalStatus === 'approved'}
                    className="inline-flex min-h-10 items-center gap-1 rounded-full border border-[#bde9c9] bg-[var(--state-success-surface)] px-4 text-sm font-medium text-[var(--state-success-text)] disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    通过
                  </button>
                  <button
                    onClick={() => runAction(agent, 'reject')}
                    disabled={actingId === agent.id || agent.approvalStatus === 'rejected'}
                    className="inline-flex min-h-10 items-center gap-1 rounded-full border border-[#ffc6c1] bg-[var(--state-error-surface)] px-4 text-sm font-medium text-[var(--state-error)] disabled:opacity-50"
                  >
                    <XCircle className="h-4 w-4" />
                    驳回
                  </button>
                  <button
                    onClick={() => runAction(agent, 'disable')}
                    disabled={actingId === agent.id || agent.approvalStatus === 'disabled'}
                    className="inline-flex min-h-10 items-center gap-1 rounded-full border border-[color:var(--border)] px-4 text-sm font-medium text-[var(--text-600)] hover:border-[var(--text-300)] disabled:opacity-50"
                  >
                    <Slash className="h-4 w-4" />
                    禁用
                  </button>
                </div>
              </div>
            </article>
          ))}
          </div>
        </section>
      )}
    </div>
  );
}
