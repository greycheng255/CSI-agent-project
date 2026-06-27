import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Bot, Loader2, Search, Star, Zap } from 'lucide-react';
import {
  isCatalogItemRunnable,
  loadAgentDirectory,
  type AgentDirectory,
} from '../api/agentMarketApi';
import { AGENT_CATALOG, AGENT_STYLE, type AgentCatalogItem } from '../data/agentMarketCatalog';

function AgentMarketCard({
  agent,
  directory,
}: {
  agent: AgentCatalogItem;
  directory: AgentDirectory | null;
}) {
  const style = AGENT_STYLE[agent.color];
  const runnable = directory ? isCatalogItemRunnable(agent, directory) : false;

  return (
    <Link
      to={`/agent-market/${agent.id}`}
      className="group flex min-h-[176px] flex-col rounded-lg border border-gray-800 bg-[#0a0a0a] p-3.5 transition-colors hover:border-green-500/40"
    >
      <div className="flex items-start gap-2.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-green-500/10"
          style={{ borderColor: style.border }}
        >
          <Bot className="h-4 w-4" style={{ color: style.text }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-bold text-gray-100 group-hover:text-green-400">
              {agent.name}
            </h3>
            {!runnable && (
              <span className="shrink-0 rounded-full border border-gray-700 bg-gray-900 px-2 py-0.5 text-[10px] font-bold text-gray-500">
                接口未开放
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">{agent.desc}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {agent.tags.map((tag) => (
          <span
            key={tag}
            className="rounded border px-2 py-1 text-[11px] font-bold leading-none"
            style={{ color: style.text, background: style.bg, borderColor: style.border }}
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-3 border-t border-gray-800 pt-2.5 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <Star className="h-3 w-3" style={{ color: style.text }} />
          {agent.rating.toFixed(1)}
        </span>
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3" style={{ color: style.text }} />
          {agent.calls.toLocaleString()} 次
        </span>
        <span
          className="ml-auto flex items-center gap-1 font-bold"
          style={{ color: runnable ? style.text : 'rgb(107 114 128)' }}
        >
          {runnable ? '运行' : '查看'}
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}

export default function AgentMarket() {
  const [directory, setDirectory] = useState<AgentDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('全部');

  useEffect(() => {
    let cancelled = false;

    loadAgentDirectory()
      .then((data) => {
        if (cancelled) return;
        setDirectory(data);
        setError(data.error || '');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '加载智能体目录失败');
        setDirectory(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    AGENT_CATALOG.forEach((agent) => agent.tags.forEach((tag) => tags.add(tag)));
    return ['全部', ...Array.from(tags)];
  }, []);

  const filteredAgents = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return AGENT_CATALOG.filter((agent) => {
      if (activeTag !== '全部' && !agent.tags.includes(activeTag)) return false;
      if (!keyword) return true;

      return (
        agent.name.toLowerCase().includes(keyword) ||
        agent.desc.toLowerCase().includes(keyword) ||
        agent.tags.some((tag) => tag.toLowerCase().includes(keyword))
      );
    });
  }, [activeTag, search]);

  const runnableCount = useMemo(() => {
    if (!directory) return 0;
    return AGENT_CATALOG.filter((agent) => isCatalogItemRunnable(agent, directory)).length;
  }, [directory]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-3xl font-bold text-gray-100">智能体集市</h1>
          <p className="mt-2 text-sm text-gray-500">选择一个专业智能体，进入独立执行页面</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {loading && (
            <span className="inline-flex items-center gap-2 rounded border border-gray-800 bg-gray-900/70 px-3 py-2 text-xs text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              同步第三方目录
            </span>
          )}
          <span className="inline-flex items-center gap-2 rounded border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs font-bold text-green-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            {runnableCount} 个可运行 / {AGENT_CATALOG.length} 个模块
          </span>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4 text-sm text-yellow-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-bold">第三方目录使用本地 fallback 展示</div>
            <div className="mt-1 text-yellow-200/70">{error}</div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
        <div className="space-y-4">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索智能体..."
              className="w-full rounded-lg border border-gray-700 bg-black py-2.5 pl-10 pr-4 text-sm text-gray-200 outline-none transition-colors placeholder:text-gray-600 focus:border-green-500"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {allTags.map((tag) => {
              const active = tag === activeTag;
              return (
                <button
                  key={tag}
                  onClick={() => setActiveTag(tag)}
                  className={`whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                    active
                      ? 'border-green-500/50 bg-green-500/10 text-green-400'
                      : 'border-gray-800 bg-black text-gray-500 hover:border-gray-600 hover:text-gray-300'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {filteredAgents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 py-16 text-center text-gray-500">
          没有匹配的智能体
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {filteredAgents.map((agent) => (
            <AgentMarketCard key={agent.id} agent={agent} directory={directory} />
          ))}
        </div>
      )}
    </div>
  );
}
