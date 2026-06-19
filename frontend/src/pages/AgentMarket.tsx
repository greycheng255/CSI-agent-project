import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Search } from 'lucide-react';
import { discoverAgents, getAgentTags } from '../api/agentsApi';
import { AgentCard } from '../components/agents/AgentCard';
import type { Agent, AgentTagCount } from '../types/agent';

const PAGE_SIZE = 12;

export default function AgentMarket() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tags, setTags] = useState<AgentTagCount[]>([]);
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError('');
      try {
        const result = await discoverAgents({
          query: query.trim() || undefined,
          tags: activeTag || undefined,
          limit: PAGE_SIZE,
          offset,
        });
        const items = result.items || [];
        setAgents(append ? (prev) => [...prev, ...items] : items);
        setTotal(result.total ?? 0);
        setHasMore(offset + PAGE_SIZE < (result.total ?? 0));
      } catch (err) {
        setError(err instanceof Error ? err.message : '读取失败');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [activeTag, query],
  );

  // 筛选条件变化时重置
  useEffect(() => {
    fetchPage(0, false);
  }, [fetchPage]);

  useEffect(() => {
    getAgentTags().then(setTags).catch(() => setTags([]));
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fetchPage(0, false);
    }, 300);
  };

  const handleTagClick = (tag: string) => {
    setActiveTag(tag);
    fetchPage(0, false);
  };

  const loadMore = () => {
    if (loadingMore || !hasMore) return;
    fetchPage(agents.length, true);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-100">
            <Bot className="h-5 w-5 text-green-400" />
            智能体广场
          </h1>
          <p className="mt-1 text-xs text-gray-500">已审核 Agent · 共 {total} 个</p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            fetchPage(0, false);
          }}
          className="flex w-full gap-2 md:w-[360px]"
        >
          <input
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            className="field-input text-sm"
            placeholder="搜索名称或描述"
          />
          <button className="flex items-center justify-center gap-1 rounded bg-green-500 px-3.5 py-2 text-sm font-bold text-black hover:bg-green-400 shrink-0">
            <Search className="h-4 w-4" />
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => handleTagClick('')}
          className={`rounded border px-2.5 py-1 text-xs ${
            !activeTag ? 'border-green-500 bg-green-500/10 text-green-300' : 'border-gray-800 text-gray-400 hover:text-gray-200'
          }`}
        >
          全部
        </button>
        {tags.slice(0, 16).map((item) => (
          <button
            key={`${item.tagType}-${item.tag}`}
            onClick={() => handleTagClick(item.tag)}
            className={`rounded border px-2.5 py-1 text-xs ${
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
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 读取中...
        </div>
      ) : error ? (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-300">{error}</div>
      ) : agents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-800 p-12 text-center text-sm text-gray-500">
          暂无符合条件的已审核 Agent
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} to={`/agents/${agent.id}`} />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-2 pb-8">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded border border-gray-700 px-6 py-2 text-sm text-gray-400 hover:border-green-500/40 hover:text-green-300 disabled:opacity-40"
              >
                {loadingMore ? (
                  <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> 加载中...</span>
                ) : (
                  '加载更多'
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
