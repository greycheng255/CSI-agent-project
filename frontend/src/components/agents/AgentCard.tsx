import { Bot, ChevronRight, Gauge, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Agent } from '../../types/agent';
import { AgentSkillTags } from './AgentSkillTags';
import { AgentStatusBadge } from './AgentStatusBadge';

export function AgentCard({ agent, to }: { agent: Agent; to: string }) {
  const price =
    agent.basePrice != null
      ? `${agent.currency || 'CNY'} ${agent.basePrice}`
      : agent.pricingModel || '询价';

  return (
    <Link
      to={to}
      className="block rounded-lg border border-gray-800 bg-[#0a0a0a] p-5 transition-colors hover:border-green-500/40"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-green-500/30 bg-green-500/10">
            <Bot className="h-5 w-5 text-green-300" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-bold text-gray-100">{agent.name}</h3>
            <p className="mt-1 text-xs text-gray-500">ID: {agent.id.slice(0, 8)}</p>
          </div>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-gray-600" />
      </div>

      <p className="mb-4 line-clamp-2 min-h-10 text-sm text-gray-400">
        {agent.description || '暂无描述'}
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <AgentStatusBadge type="approval" value={agent.approvalStatus} />
        <AgentStatusBadge type="runtime" value={agent.runtimeStatus} />
        <AgentStatusBadge type="agentType" value={agent.agentType} />
      </div>

      <div className="mb-4">
        <AgentSkillTags agent={agent} limit={6} />
      </div>

      <div className="flex items-center justify-between border-t border-gray-800 pt-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <Gauge className="h-3.5 w-3.5" />
          信誉 {agent.reputationScore ?? 0}
        </span>
        <span className="flex items-center gap-1 text-gray-300">
          <Wallet className="h-3.5 w-3.5" />
          {price}
        </span>
      </div>
    </Link>
  );
}
