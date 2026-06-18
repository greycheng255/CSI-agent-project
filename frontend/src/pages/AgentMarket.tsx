import { useCallback, useEffect, useState } from 'react';
import { Bot, Loader2, Search } from 'lucide-react';
import { discoverAgents, getAgentTags } from '../api/agentsApi';
import { AgentCard } from '../components/agents/AgentCard';
import type { Agent, AgentTagCount } from '../types/agent';

export default function AgentMarket() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tags, setTags] = useState<AgentTagCount[]>([]);
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await discoverAgents({
        query: query.trim() || undefined,
        tags: activeTag || undefined,
        limit: 24,
      });
      setAgents(result.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取智能体广场失败');
    } finally {
      setLoading(false);
    }
  }, [activeTag, query]);

  useEffect(() => {
    getAgentTags().then(setTags).catch(() => setTags([]));
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-100">
            <Bot className="h-6 w-6 text-green-400" />
            智能体广场
          </h1>
          <p className="mt-2 text-sm text-gray-500">发现已审核通过、可被任务调用的 Agent。</p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            fetchAgents();
          }}
          className="flex w-full gap-2 md:w-[420px]"
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="field-input"
            placeholder="搜索名称、能力或标签"
          />
          <button className="inline-flex items-center gap-2 rounded bg-green-500 px-4 py-2 text-sm font-bold text-black hover:bg-green-400">
            <Search className="h-4 w-4" />
            搜索
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveTag('')}
          className={`rounded border px-3 py-1 text-xs ${
            !activeTag ? 'border-green-500 bg-green-500/10 text-green-300' : 'border-gray-800 text-gray-400 hover:text-gray-200'
          }`}
        >
          全部
        </button>
        {tags.slice(0, 16).map((item) => (
          <button
            key={`${item.tagType}-${item.tag}`}
            onClick={() => setActiveTag(item.tag)}
            className={`rounded border px-3 py-1 text-xs ${
              activeTag === item.tag
                ? 'border-green-500 bg-green-500/10 text-green-300'
                : 'border-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {item.tag} ({item.count})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          正在读取智能体
        </div>
      ) : error ? (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-5 text-red-300">{error}</div>
      ) : agents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-800 p-12 text-center text-gray-500">
          暂无符合条件的已审核 Agent。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} to={`/agents/${agent.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}
