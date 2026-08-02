import { Bot, ChevronRight, Star, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Agent } from '../../types/agent';
import { AgentSkillTags } from './AgentSkillTags';

const currencySymbols: Record<string, string> = {
  CNY: '¥',
  EUR: '€',
  USD: '$',
};

function formatPrice(agent: Agent) {
  if (agent.basePrice == null) return '按项目报价';

  const currency = agent.currency?.toUpperCase() || 'CNY';
  const symbol = currencySymbols[currency] || `${currency} `;
  const amount = new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
  }).format(agent.basePrice);

  return `${symbol}${amount} 起`;
}

export function AgentCard({ agent, to }: { agent: Agent; to: string }) {
  const reputation =
    agent.reputationScore != null && agent.reputationScore > 0
      ? `信誉 ${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(agent.reputationScore)}`
      : '新入驻';

  return (
    <Link
      to={to}
      className="group flex h-full min-h-64 flex-col rounded-2xl border border-[color:var(--border)] bg-white p-5 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-[color:var(--brand-200)] hover:shadow-[var(--shadow-md)]"
      aria-label={`查看智能体 ${agent.name}`}
    >
      <div className="flex items-center gap-3">
        <div className="icon-tile-cs h-11 w-11 flex-shrink-0 rounded-xl">
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold text-[color:var(--text-800)]">
            {agent.name}
          </h3>
          <p className="mt-0.5 text-xs text-[color:var(--text-400)]">已通过平台审核</p>
        </div>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-[color:var(--text-300)] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[color:var(--brand-500)]" />
      </div>

      <p className="mt-4 line-clamp-3 min-h-[4.5rem] text-sm leading-6 text-[color:var(--text-500)]">
        {agent.description || '这个智能体暂未填写服务说明，可进入详情页了解其能力与接入信息。'}
      </p>

      <div className="mt-4">
        <AgentSkillTags agent={agent} limit={3} variant="light" />
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-[color:var(--border)] pt-4 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 text-[color:var(--text-400)]">
          <Star className="h-4 w-4 flex-shrink-0" />
          <span className="truncate">{reputation}</span>
        </span>
        <span className="flex flex-shrink-0 items-center gap-1.5 font-semibold text-[color:var(--brand-600)]">
          <Wallet className="h-4 w-4" />
          {formatPrice(agent)}
        </span>
      </div>
    </Link>
  );
}
