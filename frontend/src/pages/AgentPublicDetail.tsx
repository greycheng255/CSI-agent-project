import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, ExternalLink, HeartPulse, Wallet } from 'lucide-react';
import { getPublicAgent } from '../api/agentsApi';
import { AgentSkillTags } from '../components/agents/AgentSkillTags';
import { AgentStatusBadge } from '../components/agents/AgentStatusBadge';
import type { Agent } from '../types/agent';

export default function AgentPublicDetail() {
  const { id } = useParams();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getPublicAgent(id)
      .then((data) => {
        if (data.approvalStatus && data.approvalStatus !== 'approved') {
          throw new Error('该 Agent 尚未公开');
        }
        setAgent(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : '读取 Agent 失败'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="py-20 text-center text-gray-500">读取 Agent 详情中...</div>;
  if (error || !agent) return <div className="rounded border border-red-500/30 bg-red-500/10 p-5 text-red-300">{error || 'Agent 不存在'}</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link to="/agents" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-green-300">
        <ArrowLeft className="h-4 w-4" />
        返回智能体广场
      </Link>

      <section className="rounded-lg border border-gray-800 bg-[#0a0a0a] p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div className="flex gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-green-500/30 bg-green-500/10">
              <Bot className="h-7 w-7 text-green-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-100">{agent.name}</h1>
              <p className="mt-2 max-w-2xl text-sm text-gray-400">{agent.description || '暂无描述'}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <AgentStatusBadge type="runtime" value={agent.runtimeStatus} />
            <AgentStatusBadge type="agentType" value={agent.agentType} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Info icon={<Wallet className="h-4 w-4" />} label="定价" value={agent.basePrice != null ? `${agent.currency || 'CNY'} ${agent.basePrice}` : agent.pricingModel || '询价'} />
        <Info icon={<HeartPulse className="h-4 w-4" />} label="健康检查" value={agent.healthUrl ? '已配置' : '未公开'} />
        <Info icon={<ExternalLink className="h-4 w-4" />} label="版本" value={agent.version || '1.0.0'} />
      </section>

      <section className="rounded-lg border border-gray-800 bg-[#0a0a0a] p-6">
        <h2 className="mb-4 text-lg font-bold text-gray-100">能力与标签</h2>
        <AgentSkillTags agent={agent} limit={30} />
      </section>

      <section className="rounded-lg border border-gray-800 bg-[#0a0a0a] p-6">
        <h2 className="mb-4 text-lg font-bold text-gray-100">公开接入信息</h2>
        <div className="space-y-3 text-sm">
          <Row label="Endpoint" value={agent.endpointUrl || '未公开'} />
          <Row label="Card URL" value={agent.cardUrl || '未公开'} />
          <Row label="Auth Type" value={agent.authType || '未公开'} />
        </div>
      </section>
    </div>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-[#0a0a0a] p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">{icon}{label}</div>
      <div className="text-sm font-semibold text-gray-100">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 md:grid-cols-[140px_1fr]">
      <span className="text-gray-500">{label}</span>
      <span className="break-all text-gray-300">{value}</span>
    </div>
  );
}
