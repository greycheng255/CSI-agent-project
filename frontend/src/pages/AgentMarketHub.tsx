import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Search,
  SearchX,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  X,
  Zap,
} from 'lucide-react';
import {
  isCatalogItemRunnable,
  loadAgentDirectory,
  type AgentDirectory,
} from '../api/agentMarketApi';
import { OPENNOTEBOOK_AGENT_PROVIDER } from '../config/api';
import { AGENT_CATALOG, AGENT_STYLE, type AgentCatalogItem } from '../data/agentMarketCatalog';
import {
  openNotebookAuthorization,
  readOpenNotebookApiKey,
} from '../features/agent-market/openNotebookCredentials';
import { useAuthStore } from '../store/authStore';

const INITIAL_TAG_LIMIT = 10;

type AvailabilityFilter = 'all' | 'runnable';

function MarketCardSkeleton() {
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
        <div className="h-6 w-14 rounded-full bg-[color:var(--background-200)]" />
        <div className="h-6 w-20 rounded-full bg-[color:var(--background-200)]" />
      </div>
      <div className="mt-8 border-t border-[color:var(--border)] pt-4">
        <div className="h-3 w-3/5 rounded-full bg-[color:var(--background-200)]" />
      </div>
    </div>
  );
}

function AgentMarketCard({
  agent,
  directory,
}: {
  agent: AgentCatalogItem;
  directory: AgentDirectory;
}) {
  const style = AGENT_STYLE[agent.color];
  const runnable = isCatalogItemRunnable(agent, directory);

  return (
    <Link
      to={`/agent-market/${agent.id}`}
      className="group flex h-full min-h-64 flex-col rounded-2xl border border-[color:var(--border)] bg-white p-5 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-[color:var(--brand-200)] hover:shadow-[var(--shadow-md)]"
      aria-label={`${runnable ? '使用' : '查看'}智能体 ${agent.name}`}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border text-xl"
          style={{ background: style.bg, borderColor: style.border }}
          aria-hidden="true"
        >
          {agent.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold text-[color:var(--text-800)]">
            {agent.name}
          </h3>
          <span
            className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              runnable
                ? 'bg-[color:var(--state-success-surface)] text-[#237a3b]'
                : 'bg-[color:var(--background-100)] text-[color:var(--text-400)]'
            }`}
          >
            {runnable && <CheckCircle2 className="h-3 w-3" />}
            {runnable ? '可立即使用' : '暂未开放'}
          </span>
        </div>
        <ArrowRight className="h-4 w-4 flex-shrink-0 text-[color:var(--text-300)] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[color:var(--brand-500)]" />
      </div>

      <p className="mt-4 line-clamp-2 min-h-12 text-sm leading-6 text-[color:var(--text-500)]">
        {agent.desc}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {agent.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-[color:var(--background-100)] px-2.5 py-1 text-xs text-[color:var(--text-500)]"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-4 border-t border-[color:var(--border)] pt-4 text-xs text-[color:var(--text-400)]">
        <span className="flex items-center gap-1.5">
          <Star className="h-3.5 w-3.5 text-[#d97706]" />
          {agent.rating.toFixed(1)}
        </span>
        <span className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5" />
          {agent.calls.toLocaleString('zh-CN')} 次使用
        </span>
        <span
          className={`ml-auto font-semibold ${
            runnable ? 'text-[color:var(--brand-600)]' : 'text-[color:var(--text-400)]'
          }`}
        >
          {runnable ? '开始使用' : '查看详情'}
        </span>
      </div>
    </Link>
  );
}

export default function AgentMarketHub() {
  const accountId = useAuthStore(
    (state) => state.user?.id || state.admin?.id || 'anonymous',
  );
  const provider = useMemo(() => {
    const authorization = openNotebookAuthorization(
      readOpenNotebookApiKey(accountId),
    );
    return {
      ...OPENNOTEBOOK_AGENT_PROVIDER,
      ...(authorization ? { authorization } : {}),
    };
  }, [accountId]);
  const [directory, setDirectory] = useState<AgentDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [availability, setAvailability] = useState<AvailabilityFilter>('all');
  const [showAllTags, setShowAllTags] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadAgentDirectory(provider)
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
  }, [provider]);

  const tagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    AGENT_CATALOG.forEach((agent) => {
      agent.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });

    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));
  }, []);

  const visibleTags = useMemo(() => {
    if (showAllTags) return tagOptions;

    const initialTags = tagOptions.slice(0, INITIAL_TAG_LIMIT);
    if (!activeTag || initialTags.some((item) => item.tag === activeTag)) return initialTags;

    const selectedTag = tagOptions.find((item) => item.tag === activeTag);
    return selectedTag
      ? [...initialTags.slice(0, INITIAL_TAG_LIMIT - 1), selectedTag]
      : initialTags;
  }, [activeTag, showAllTags, tagOptions]);

  const runnableCount = useMemo(() => {
    if (!directory) return 0;
    return AGENT_CATALOG.filter((agent) => isCatalogItemRunnable(agent, directory)).length;
  }, [directory]);

  const filteredAgents = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return AGENT_CATALOG.filter((agent) => {
      if (activeTag && !agent.tags.includes(activeTag)) return false;
      if (
        availability === 'runnable' &&
        (!directory || !isCatalogItemRunnable(agent, directory))
      ) {
        return false;
      }
      if (!keyword) return true;

      return (
        agent.name.toLowerCase().includes(keyword) ||
        agent.desc.toLowerCase().includes(keyword) ||
        agent.tags.some((tag) => tag.toLowerCase().includes(keyword))
      );
    });
  }, [activeTag, availability, directory, search]);

  const filteredRunnableCount = useMemo(() => {
    if (!directory) return 0;
    return filteredAgents.filter((agent) => isCatalogItemRunnable(agent, directory)).length;
  }, [directory, filteredAgents]);

  const hasFilter = search.trim() !== '' || activeTag !== '' || availability !== 'all';
  const activeFilterCount =
    Number(Boolean(search.trim())) +
    Number(Boolean(activeTag)) +
    Number(availability !== 'all');

  const resultTitle = activeTag
    ? `${activeTag}智能体`
    : availability === 'runnable'
      ? '可立即使用'
      : search.trim()
        ? '搜索结果'
        : '全部智能体';

  const clearFilters = () => {
    setSearch('');
    setActiveTag('');
    setAvailability('all');
  };

  return (
    <div className="w-full pb-10">
      <header className="flex items-start gap-3">
        <span className="icon-tile-cs h-11 w-11 flex-shrink-0 rounded-xl">
          <ShoppingBag className="h-5 w-5 text-white" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-[color:var(--text-800)]">
            智能体集市
          </h1>
          <p className="mt-1 text-sm text-[color:var(--text-500)]">
            选择专业智能体，配置任务后直接生成内容或执行工作流
          </p>
        </div>
      </header>

      <div className="mt-7 grid items-start gap-6 lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside
          className={`${mobileFiltersOpen ? 'block' : 'hidden'} lg:sticky lg:top-20 lg:block`}
          aria-label="智能体集市筛选条件"
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

            <div className="mt-5">
              <label
                htmlFor="market-agent-search"
                className="mb-2 block text-xs font-semibold text-[color:var(--text-500)]"
              >
                搜索
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--text-400)]" />
                <input
                  id="market-agent-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-11 w-full rounded-xl border border-[color:var(--background-300)] bg-white pl-9 pr-10 text-sm text-[color:var(--text-800)] outline-none transition-[border-color,box-shadow] placeholder:text-[color:var(--text-400)] focus:border-[color:var(--brand-500)] focus:ring-4 focus:ring-blue-500/10"
                  placeholder="名称、用途或能力"
                  autoComplete="off"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-[color:var(--text-400)] transition-colors hover:text-[color:var(--text-700)]"
                    aria-label="清除搜索内容"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="mt-6 border-t border-[color:var(--border)] pt-5">
              <p className="mb-3 text-xs font-semibold text-[color:var(--text-500)]">使用状态</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAvailability('all')}
                  className={`min-h-11 rounded-xl px-2 text-xs font-semibold transition-colors ${
                    availability === 'all'
                      ? 'bg-[color:var(--brand-500)] text-white'
                      : 'bg-[color:var(--background-100)] text-[color:var(--text-600)] hover:bg-[color:var(--brand-50)] hover:text-[color:var(--brand-600)]'
                  }`}
                  aria-pressed={availability === 'all'}
                >
                  全部 {AGENT_CATALOG.length}
                </button>
                <button
                  type="button"
                  onClick={() => setAvailability('runnable')}
                  className={`min-h-11 rounded-xl px-2 text-xs font-semibold transition-colors ${
                    availability === 'runnable'
                      ? 'bg-[color:var(--brand-500)] text-white'
                      : 'bg-[color:var(--background-100)] text-[color:var(--text-600)] hover:bg-[color:var(--brand-50)] hover:text-[color:var(--brand-600)]'
                  }`}
                  aria-pressed={availability === 'runnable'}
                >
                  可使用 {loading ? '—' : runnableCount}
                </button>
              </div>
            </div>

            <div className="mt-6 border-t border-[color:var(--border)] pt-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-[color:var(--text-500)]">能力分类</p>
                {tagOptions.length > INITIAL_TAG_LIMIT && (
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
                  const active = item.tag === activeTag;
                  return (
                    <button
                      type="button"
                      key={item.tag}
                      onClick={() => setActiveTag(active ? '' : item.tag)}
                      className={`flex min-h-11 max-w-full items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${
                        active
                          ? 'bg-[color:var(--brand-500)] text-white'
                          : 'bg-[color:var(--background-100)] text-[color:var(--text-600)] hover:bg-[color:var(--brand-50)] hover:text-[color:var(--brand-600)]'
                      }`}
                      aria-pressed={active}
                    >
                      <span className="truncate">{item.tag}</span>
                      <span
                        className={
                          active ? 'text-white/75' : 'text-[color:var(--text-400)]'
                        }
                      >
                        {item.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

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

        <section className="min-w-0" aria-labelledby="market-results-title">
          <div className="mb-5 flex min-h-11 flex-wrap items-center justify-between gap-3">
            <div>
              <h2
                id="market-results-title"
                className="text-lg font-bold text-[color:var(--text-800)]"
              >
                {resultTitle}
              </h2>
              <p className="mt-0.5 text-sm text-[color:var(--text-400)]">
                {loading
                  ? '正在同步可用能力'
                  : `共找到 ${filteredAgents.length} 个智能体，其中 ${filteredRunnableCount} 个可立即使用`}
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
              {activeFilterCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[color:var(--brand-500)] px-1 text-[11px] text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {error && directory && (
            <div className="mb-5 flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
              <div className="min-w-0">
                <p className="font-semibold">部分在线能力暂时不可用，当前已切换到本地目录。</p>
                <p className="mt-0.5 text-xs leading-5 text-amber-800">
                  标记为“可立即使用”的智能体仍可正常进入任务配置。
                </p>
              </div>
            </div>
          )}

          {loading || !directory ? (
            loading ? (
              <div
                className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4"
                aria-label="正在加载智能体集市"
              >
                {Array.from({ length: 8 }, (_, index) => (
                  <MarketCardSkeleton key={index} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-[color:var(--state-error-surface)] px-6 py-12 text-center">
                <p className="font-semibold text-[color:var(--state-error)]">智能体目录加载失败</p>
                <p className="mt-2 text-sm text-[color:var(--text-500)]">
                  请刷新页面后重试，或稍后再回来。
                </p>
              </div>
            )
          ) : filteredAgents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[color:var(--background-400)] px-6 py-16 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--background-100)] text-[color:var(--text-400)]">
                <SearchX className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-base font-bold text-[color:var(--text-700)]">
                没有找到匹配的智能体
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[color:var(--text-400)]">
                试试缩短关键词，或选择其他能力分类。
              </p>
              <button type="button" onClick={clearFilters} className="btn-cs btn-primary mt-6">
                查看全部智能体
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4">
              {filteredAgents.map((agent) => (
                <AgentMarketCard key={agent.id} agent={agent} directory={directory} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
