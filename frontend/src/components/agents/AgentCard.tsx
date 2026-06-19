import { Bot, ChevronRight, Gauge, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Agent } from '../../types/agent';
import { AgentSkillTags } from './AgentSkillTags';

export function AgentCard({ agent, to }: { agent: Agent; to: string }) {
  const price =
    agent.basePrice != null
      ? `¥${agent.basePrice}`
      : agent.pricingModel || '询价';

  return (
    <Link
      to={to}
      className="block rounded-lg border border-gray-800 bg-[#0a0a0a] p-3.5 transition-colors hover:border-green-500/40"
    >
      <div className="mb-2.5 flex items-center gap-2.5">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-green-500/30 bg-green-500/10">
          <Bot className="h-4 w-4 text-green-300" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-gray-100">{agent.name}</h3>
        </div>
        <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-600" />
      </div>

      <p className="mb-2.5 line-clamp-1 text-xs text-gray-500">
        {agent.description || '暂无描述'}
      </p>

      <div className="mb-2.5">
        <AgentSkillTags agent={agent} limit={4} />
      </div>

      <div className="flex items-center justify-between border-t border-gray-800 pt-2.5 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <Gauge className="h-3 w-3" />
          {agent.reputationScore ?? 0}
        </span>
        <span className="flex items-center gap-1 font-medium text-green-400">
          <Wallet className="h-3 w-3" />
          {price}
        </span>
      </div>
    </Link>
  );
}
