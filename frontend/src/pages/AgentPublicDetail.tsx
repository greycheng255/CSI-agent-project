import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, ExternalLink, HeartPulse, Wallet } from 'lucide-react';
import { getPublicAgent } from '../api/agentsApi';
import { AgentSkillTags } from '../components/agents/AgentSkillTags';
import { AgentStatusBadge } from '../components/agents/AgentStatusBadge';
import { WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';
import type { Agent } from '../types/agent';

type DetailState =
  | { status: 'loading'; agent: null; error: '' }
  | { status: 'ready'; agent: Agent; error: '' }
  | { status: 'error'; agent: null; error: string };

export default function AgentPublicDetail() {
  const { id } = useParams();
  const [state, setState] = useState<DetailState>({ status: 'loading', agent: null, error: '' });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    getPublicAgent(id)
      .then((agent) => {
        if (agent.approvalStatus && agent.approvalStatus !== 'approved') {
          throw new Error('该 Agent 尚未公开');
        }
        if (!cancelled) setState({ status: 'ready', agent, error: '' });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ status: 'error', agent: null, error: error instanceof Error ? error.message : '读取 Agent 失败' });
        }
      });

    return () => { cancelled = true; };
  }, [id]);

  if (state.status === 'loading') {
    return (
      <div className="mx-auto w-full max-w-[1440px] space-y-5" aria-label="正在读取 Agent 详情">
        <div className="h-8 w-36 animate-pulse rounded-lg bg-[var(--background-100)]" />
        <div className="h-36 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
          <div className="h-72 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
          <div className="h-72 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="mx-auto w-full max-w-3xl py-8">
        <WorkbenchStatePanel
          icon={Bot}
          title="无法查看该智能体"
          description={state.error}
          tone="error"
          action={<Link to="/agents" className="btn-cs btn-primary btn-sm">返回智能体广场</Link>}
        />
      </div>
    );
  }

  const { agent } = state;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <Link to="/agents" className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-[var(--brand-600)] hover:text-[var(--brand-700)]">
        <ArrowLeft className="h-4 w-4" />返回智能体广场
      </Link>

      <header className="flex flex-col gap-5 border-b border-[color:var(--border)] pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)] text-[var(--brand-600)]">
            <Bot className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text-900)]">{agent.name}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-500)]">{agent.description || '该智能体暂未填写介绍。'}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <AgentStatusBadge type="runtime" value={agent.runtimeStatus} />
          <AgentStatusBadge type="agentType" value={agent.agentType} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
          <div className="border-b border-[color:var(--border)] px-5 py-5 sm:px-6">
            <h2 className="font-semibold text-[var(--text-900)]">能力与标签</h2>
            <p className="mt-1 text-sm text-[var(--text-500)]">了解该智能体适合处理的任务方向。</p>
          </div>
          <div className="min-h-28 px-5 py-5 sm:px-6">
            <AgentSkillTags agent={agent} limit={30} />
          </div>

          <div className="border-t border-[color:var(--border)] px-5 py-5 sm:px-6">
            <h3 className="text-sm font-semibold text-[var(--text-800)]">公开接入信息</h3>
            <dl className="mt-4 divide-y divide-[color:var(--border)]">
              <InfoRow label="Endpoint" value={agent.endpointUrl || '未公开'} />
              <InfoRow label="Card URL" value={agent.cardUrl || '未公开'} />
              <InfoRow label="认证方式" value={agent.authType || '未公开'} />
            </dl>
          </div>
        </section>

        <aside className="h-fit overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
          <div className="border-b border-[color:var(--border)] px-5 py-5">
            <h2 className="font-semibold text-[var(--text-900)]">智能体概览</h2>
          </div>
          <dl className="divide-y divide-[color:var(--border)]">
            <OverviewRow icon={Wallet} label="定价" value={agent.basePrice != null ? `${agent.currency || 'CNY'} ${agent.basePrice}` : agent.pricingModel || '询价'} />
            <OverviewRow icon={HeartPulse} label="健康检查" value={agent.healthUrl ? '已配置' : '未公开'} />
            <OverviewRow icon={ExternalLink} label="当前版本" value={agent.version || '1.0.0'} />
          </dl>
        </aside>
      </div>
    </div>
  );
}

function OverviewRow({ icon: Icon, label, value }: { icon: typeof Wallet; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-600)]" />
      <div><dt className="text-xs text-[var(--text-500)]">{label}</dt><dd className="mt-1 break-all text-sm font-medium text-[var(--text-800)]">{value}</dd></div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[120px_minmax(0,1fr)]">
      <dt className="text-sm text-[var(--text-500)]">{label}</dt>
      <dd className="break-all text-sm font-medium text-[var(--text-700)]">{value}</dd>
    </div>
  );
}
