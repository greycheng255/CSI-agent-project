import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Loader2,
  RotateCcw,
  Search,
  SearchX,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { discoverAgents, getAgentTags } from '../api/agentsApi';
import { AgentCard } from '../components/agents/AgentCard';
import type { Agent, AgentTagCount } from '../types/agent';

const PAGE_SIZE = 12;
const INITIAL_TAG_LIMIT = 10;

const INTERNAL_TAGS = new Set([
  'fixed',
  'general',
  'hourly',
  'platform',
  'platform-managed',
  'platform-runtime',
  'quote',
  'quota',
  'self-hosted',
  'system-created',
]);

function isDiscoverableTag(item: AgentTagCount) {
  const tag = item.tag.trim().toLowerCase();

  if (!tag || item.tagType === 'source' || item.tagType === 'pricing') return false;
  if (INTERNAL_TAGS.has(tag)) return false;
  if (tag.includes('\uFFFD')) return false;
  if (/^(agent|owner|platform|system):/.test(tag)) return false;
  if (/^wp\d+[-_]/.test(tag) || /(^|[-_])(test|demo)([-_]|$)/.test(tag)) return false;

  return true;
}

function formatTagLabel(tag: string) {
  return tag.trim().toLowerCase() === 'ai' ? 'AI' : tag;
}

function AgentCardSkeleton() {
  return (
    <div
      className="min-h-64 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white p-5"
      aria-hidden="true"
    >
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-[color:var(--background-200)]" />
        <div className="h-4 w-2/5 rounded-full bg-[color:var(--background-200)]" />
      </div>
      <div className="mt-5 space-y-2.5">
        <div className="h-3 w-full rounded-full bg-[color:var(--background-200)]" />
        <div className="h-3 w-4/5 rounded-full bg-[color:var(--background-200)]" />
      </div>
      <div className="mt-5 flex gap-2">
        <div className="h-6 w-16 rounded-full bg-[color:var(--background-200)]" />
        <div className="h-6 w-20 rounded-full bg-[color:var(--background-200)]" />
        <div className="h-6 w-14 rounded-full bg-[color:var(--background-200)]" />
      </div>
      <div className="mt-8 border-t border-[color:var(--border)] pt-4">
        <div className="h-3 w-1/2 rounded-full bg-[color:var(--background-200)]" />
      </div>
    </div>
  );
}

export default function AgentMarket() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tags, setTags] = useState<AgentTagCount[]>([]);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [showAllTags, setShowAllTags] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const discoverableTags = useMemo(
    () => {
      const uniqueTags = new Map<string, AgentTagCount>();

      tags
        .filter(isDiscoverableTag)
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
        .forEach((item) => {
          const key = item.tag.trim().toLocaleLowerCase();
          if (!uniqueTags.has(key)) uniqueTags.set(key, item);
        });

      return Array.from(uniqueTags.values());
    },
    [tags],
  );

  const visibleTags = useMemo(() => {
    if (showAllTags) return discoverableTags;

    const initialTags = discoverableTags.slice(0, INITIAL_TAG_LIMIT);
    if (!activeTag || initialTags.some((item) => item.tag === activeTag)) return initialTags;

    const selectedTag = discoverableTags.find((item) => item.tag === activeTag);
    return selectedTag
      ? [...initialTags.slice(0, INITIAL_TAG_LIMIT - 1), selectedTag]
      : initialTags;
  }, [activeTag, discoverableTags, showAllTags]);

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
          query: debouncedQuery || undefined,
          tags: activeTag || undefined,
          limit: PAGE_SIZE,
          offset,
        });
        const items = result.items || [];
        setAgents(append ? (previous) => [...previous, ...items] : items);
        setTotal(result.total ?? 0);
        setHasMore(offset + PAGE_SIZE < (result.total ?? 0));
      } catch (err) {
        setError(err instanceof Error ? err.message : '读取失败');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [activeTag, debouncedQuery],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 300);

    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    fetchPage(0, false);
  }, [fetchPage]);

  useEffect(() => {
    getAgentTags().then(setTags).catch(() => setTags([]));
  }, []);

  const hasFilter = debouncedQuery !== '' || activeTag !== '';
  const resultTitle = activeTag
    ? `${formatTagLabel(activeTag)} 相关智能体`
    : debouncedQuery
      ? '搜索结果'
      : '全部智能体';

  const clearFilters = () => {
    setQuery('');
    setDebouncedQuery('');
    setActiveTag('');
  };

  const selectTag = (tag: string) => {
    setActiveTag((current) => (current === tag ? '' : tag));
  };

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDebouncedQuery(query.trim());
  };

  const loadMore = () => {
    if (loadingMore || !hasMore) return;
    fetchPage(agents.length, true);
  };

  return (
    <div className="w-full pb-10">
      <header className="flex items-start gap-3">
        <span className="icon-tile-cs h-11 w-11 flex-shrink-0 rounded-xl">
          <Bot className="h-5 w-5 text-white" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-[color:var(--text-800)]">
            智能体广场
          </h1>
          <p className="mt-1 text-sm text-[color:var(--text-500)]">
            按名称、能力或服务方向，找到适合当前任务的智能体
          </p>
        </div>
      </header>

      <div className="mt-7 grid items-start gap-6 lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside
          className={`${mobileFiltersOpen ? 'block' : 'hidden'} lg:sticky lg:top-20 lg:block`}
          aria-label="智能体筛选条件"
        >
          <div className="rounded-2xl border border-[color:var(--border)] bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-[color:var(--brand-500)]" />
                <h2 className="text-sm font-bold text-[color:var(--text-700)]">筛选智能体</h2>
              </div>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-[color:var(--text-400)] hover:bg-[color:var(--background-100)] lg:hidden"
                aria-label="收起筛选条件"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={submitSearch} className="mt-5">
              <label
                htmlFor="agent-search"
                className="mb-2 block text-xs font-semibold text-[color:var(--text-500)]"
              >
                搜索
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--text-400)]" />
                <input
                  id="agent-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-11 w-full rounded-xl border border-[color:var(--background-300)] bg-white pl-9 pr-10 text-sm text-[color:var(--text-800)] outline-none transition-[border-color,box-shadow] placeholder:text-[color:var(--text-400)] focus:border-[color:var(--brand-500)] focus:ring-4 focus:ring-blue-500/10"
                  placeholder="名称、能力或描述"
                  autoComplete="off"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-[color:var(--text-400)] transition-colors hover:text-[color:var(--text-700)]"
                    aria-label="清除搜索内容"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </form>

            {discoverableTags.length > 0 && (
              <div className="mt-6 border-t border-[color:var(--border)] pt-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-[color:var(--text-500)]">服务方向</p>
                  {discoverableTags.length > INITIAL_TAG_LIMIT && (
                    <button
                      type="button"
                      onClick={() => setShowAllTags((value) => !value)}
                      className="flex min-h-11 items-center gap-0.5 rounded-lg px-1.5 text-xs font-semibold text-[color:var(--brand-600)] transition-colors hover:bg-[color:var(--brand-50)]"
                      aria-expanded={showAllTags}
                    >
                      {showAllTags ? '收起' : '更多'}
                      {showAllTags ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTag('')}
                    className={`min-h-11 rounded-full px-3 text-xs font-semibold transition-colors ${
                      !activeTag
                        ? 'bg-[color:var(--brand-500)] text-white'
                        : 'bg-[color:var(--background-100)] text-[color:var(--text-600)] hover:bg-[color:var(--brand-50)] hover:text-[color:var(--brand-600)]'
                    }`}
                    aria-pressed={!activeTag}
                  >
                    全部
                  </button>
                  {visibleTags.map((item) => {
                    const isActive = activeTag === item.tag;
                    return (
                      <button
                        type="button"
                        key={`${item.tagType}-${item.tag}`}
                        onClick={() => selectTag(item.tag)}
                        className={`flex min-h-11 max-w-full items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${
                          isActive
                            ? 'bg-[color:var(--brand-500)] text-white'
                            : 'bg-[color:var(--background-100)] text-[color:var(--text-600)] hover:bg-[color:var(--brand-50)] hover:text-[color:var(--brand-600)]'
                        }`}
                        aria-pressed={isActive}
                      >
                        <span className="truncate">{formatTagLabel(item.tag)}</span>
                        <span
                          className={
                            isActive ? 'text-white/75' : 'text-[color:var(--text-400)]'
                          }
                        >
                          {item.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {hasFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--border)] text-sm font-semibold text-[color:var(--text-500)] transition-colors hover:border-[color:var(--brand-200)] hover:bg-[color:var(--brand-50)] hover:text-[color:var(--brand-600)]"
              >
                <RotateCcw className="h-4 w-4" />
                重置筛选
              </button>
            )}
          </div>
        </aside>

        <section className="min-w-0" aria-labelledby="agent-results-title">
          <div className="mb-5 flex min-h-11 flex-wrap items-center justify-between gap-3">
            <div>
              <h2
                id="agent-results-title"
                className="text-lg font-bold text-[color:var(--text-800)]"
              >
                {resultTitle}
              </h2>
              <p className="mt-0.5 text-sm text-[color:var(--text-400)]">
                {loading ? '正在查找合适的智能体' : `共找到 ${total} 个已审核智能体`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMobileFiltersOpen((value) => !value)}
              className="flex min-h-11 items-center gap-2 rounded-xl border border-[color:var(--border)] bg-white px-3 text-sm font-semibold text-[color:var(--text-600)] lg:hidden"
              aria-expanded={mobileFiltersOpen}
            >
              <SlidersHorizontal className="h-4 w-4" />
              筛选
              {hasFilter && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[color:var(--brand-500)] px-1 text-[11px] text-white">
                  {Number(Boolean(debouncedQuery)) + Number(Boolean(activeTag))}
                </span>
              )}
            </button>
          </div>

          {loading ? (
            <div
              className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4"
              aria-label="正在加载智能体"
            >
              {Array.from({ length: 8 }, (_, index) => (
                <AgentCardSkeleton key={index} />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-2xl bg-[color:var(--state-error-surface)] px-6 py-8 text-center">
              <p className="font-semibold text-[color:var(--state-error)]">智能体列表读取失败</p>
              <p className="mt-1 text-sm text-[color:var(--text-500)]">{error}</p>
              <button
                type="button"
                onClick={() => fetchPage(0, false)}
                className="mt-5 min-h-11 rounded-full bg-white px-5 text-sm font-semibold text-[color:var(--text-700)] shadow-[var(--shadow-sm)] transition-colors hover:text-[color:var(--brand-600)]"
              >
                重新加载
              </button>
            </div>
          ) : agents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[color:var(--background-400)] px-6 py-16 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--background-100)] text-[color:var(--text-400)]">
                <SearchX className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-base font-bold text-[color:var(--text-700)]">
                {hasFilter ? '没有找到匹配的智能体' : '智能体正在陆续入驻'}
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[color:var(--text-400)]">
                {hasFilter
                  ? '试试缩短关键词，或切换到其他服务方向。'
                  : '暂时还没有通过审核的智能体，请稍后再来看看。'}
              </p>
              {hasFilter && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="btn-cs btn-primary mt-6"
                >
                  查看全部智能体
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4">
                {agents.map((agent) => (
                  <AgentCard key={agent.id} agent={agent} to={`/agents/${agent.id}`} />
                ))}
              </div>
              {hasMore && (
                <div className="flex justify-center pb-4 pt-8">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="flex min-h-11 items-center justify-center rounded-full border border-[color:var(--background-400)] bg-white px-6 text-sm font-semibold text-[color:var(--text-600)] transition-[border-color,color,background] hover:border-[color:var(--brand-300)] hover:bg-[color:var(--brand-50)] hover:text-[color:var(--brand-600)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingMore ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        正在加载
                      </span>
                    ) : (
                      '加载更多'
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
