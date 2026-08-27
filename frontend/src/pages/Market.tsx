import {
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  RefreshCw,
  RotateCcw,
  Search,
  SearchX,
  ShoppingBag,
  SlidersHorizontal,
  UserCircle2,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE } from '../config/api';
import { formatShanghaiDateTime } from '../utils/date';

type StatusGroup = 'all' | 'bidding' | 'executing' | 'completed' | 'abnormal';

interface Task {
  id: string;
  title: string;
  description?: string;
  budgetCny: number;
  expectedDeliveryAt?: string;
  status: string;
  marketStatus?: string;
  marketStatusLabel?: string;
  isAcceptingBids?: boolean;
  orderId?: string | null;
  orderStatus?: string | null;
  selectedAgent?: { id: string; name?: string | null } | null;
  dealPriceCny?: number | null;
  client?: { id: string; phone?: string };
  tags?: string[] | null;
  skillsRequired?: string[] | null;
  bidsCount?: number;
  totalBidsCount?: number;
  latestBid?: number | null;
  matchedAgents?: number;
}

const statusTabs: Array<{ value: StatusGroup; label: string }> = [
  { value: 'all', label: '全部任务' },
  { value: 'bidding', label: '招标中' },
  { value: 'executing', label: '执行中' },
  { value: 'completed', label: '已完成' },
  { value: 'abnormal', label: '异常任务' },
];

const statusTone: Record<string, string> = {
  OPEN_FOR_BIDDING: 'bg-[color:var(--brand-50)] text-[color:var(--brand-700)]',
  AWARDED_PENDING_PAYMENT: 'bg-[color:var(--state-warning-surface)] text-[color:var(--state-warning)]',
  IN_PROGRESS: 'bg-[color:var(--state-success-surface)] text-[color:var(--state-success-text)]',
  WAITING_ACCEPTANCE: 'bg-[#edf7ff] text-[#17658f]',
  PENDING_RELEASE: 'bg-[#eaf8f4] text-[#1f745e]',
  COMPLETED: 'bg-[color:var(--background-200)] text-[color:var(--text-600)]',
  REJECTED: 'bg-[color:var(--state-error-surface)] text-[color:var(--state-error)]',
  ARBITRATING: 'bg-[#f3efff] text-[#6544a5]',
  REFUNDED: 'bg-[#fff1e5] text-[#9b4d12]',
  CANCELED: 'bg-[color:var(--background-200)] text-[color:var(--text-500)]',
  CLOSED_NO_AWARD: 'bg-[color:var(--background-200)] text-[color:var(--text-500)]',
};

const splitList = (value: string) =>
  value
    .split(/[,，\s]/)
    .map((item) => item.trim())
    .filter(Boolean);

function taskTags(task: Task) {
  return Array.from(new Set([...(task.tags || []), ...(task.skillsRequired || [])])).filter(Boolean);
}

function TaskSkeleton() {
  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-white p-5">
      <div className="flex justify-between gap-6">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="h-5 w-2/3 animate-pulse rounded bg-[color:var(--background-200)]" />
          <div className="h-4 w-full animate-pulse rounded bg-[color:var(--background-200)]" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-[color:var(--background-200)]" />
        </div>
        <div className="h-8 w-24 animate-pulse rounded bg-[color:var(--background-200)]" />
      </div>
      <div className="mt-5 h-14 animate-pulse rounded-xl bg-[color:var(--background-100)]" />
    </div>
  );
}

const waitForRetry = (delay: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, delay);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('Request aborted', 'AbortError'));
      },
      { once: true },
    );
  });

async function requestTaskMarket(url: string, signal: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`任务列表请求失败：${response.status}`);
      return await response.json();
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
      if (attempt === 0) await waitForRetry(800, signal);
    }
  }
  throw lastError;
}

export default function Market() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [minBudget, setMinBudget] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [statusGroup, setStatusGroup] = useState<StatusGroup>('all');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const requestControllerRef = useRef<AbortController | null>(null);
  const apiBase = API_BASE;

  const selectedTags = useMemo(() => splitList(tagFilter), [tagFilter]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set('keyword', keyword.trim());
    if (selectedTags.length > 0) params.set('tags', selectedTags.join(','));
    if (minBudget) params.set('minBudget', minBudget);
    if (maxBudget) params.set('maxBudget', maxBudget);
    if (sortBy) params.set('sortBy', sortBy);
    params.set('statusGroup', statusGroup);
    params.set('limit', '50');
    const text = params.toString();
    return text ? `?${text}` : '';
  }, [keyword, maxBudget, minBudget, selectedTags, sortBy, statusGroup]);

  const fetchTasks = useCallback(() => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoading(true);
    setError('');
    requestTaskMarket(`${apiBase}/api/v1/tasks/market${queryString}`, controller.signal)
      .then((response) => {
        const nextTasks = (Array.isArray(response.data) ? response.data : response) as Task[];
        setTasks(nextTasks);
        const nextTags = nextTasks.flatMap(taskTags);
        setKnownTags((current) =>
          Array.from(new Set([...current, ...nextTags])).sort((left, right) =>
            left.localeCompare(right, 'zh-CN'),
          ),
        );
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error(err);
        setError('任务列表暂时无法加载，请稍后重试。');
      })
      .finally(() => {
        if (requestControllerRef.current === controller) {
          requestControllerRef.current = null;
          setLoading(false);
        }
      });
  }, [apiBase, queryString]);

  useEffect(() => {
    const timer = window.setTimeout(fetchTasks, 300);
    return () => {
      window.clearTimeout(timer);
      requestControllerRef.current?.abort();
    };
  }, [fetchTasks]);

  const toggleTag = (tag: string) => {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter((item) => item !== tag)
      : [...selectedTags, tag];
    setTagFilter(next.join(','));
  };

  const clearFilters = () => {
    setKeyword('');
    setTagFilter('');
    setMinBudget('');
    setMaxBudget('');
    setStatusGroup('all');
  };

  const activeFilterCount =
    Number(Boolean(keyword.trim())) +
    Number(statusGroup !== 'all') +
    selectedTags.length +
    Number(Boolean(minBudget || maxBudget));
  const hasFilter = activeFilterCount > 0;
  const activeStatusLabel =
    statusTabs.find((item) => item.value === statusGroup)?.label || '全部任务';

  return (
    <div className="w-full pb-10">
      <header className="flex flex-col gap-4 border-b border-[color:var(--border)] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="icon-tile-cs h-11 w-11 rounded-xl">
              <ShoppingBag className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[color:var(--text-900)]">任务大厅</h1>
              <p className="mt-1 text-sm text-[color:var(--text-500)]">
                浏览公开任务，选择与你能力和预算匹配的合作机会
              </p>
            </div>
          </div>
        </div>
        <Link to="/tasks/new" className="btn-cs btn-primary self-start sm:self-auto">
          发布新任务
        </Link>
      </header>

      <div className="mt-7 grid items-start gap-6 lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside
          className={`${mobileFiltersOpen ? 'block' : 'hidden'} lg:sticky lg:top-20 lg:block`}
          aria-label="任务筛选条件"
        >
          <div className="rounded-2xl border border-[color:var(--border)] bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-[color:var(--brand-500)]" />
                <h2 className="text-sm font-bold text-[color:var(--text-700)]">筛选任务</h2>
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
                htmlFor="task-market-search"
                className="mb-2 block text-xs font-semibold text-[color:var(--text-600)]"
              >
                搜索
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--text-500)]" />
                <input
                  id="task-market-search"
                  type="search"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="任务标题或描述"
                  className="h-11 w-full rounded-xl border border-[color:var(--border)] bg-white pl-9 pr-3 text-sm text-[color:var(--text-800)] outline-none transition-[border-color,box-shadow] placeholder:text-[color:var(--text-500)] focus:border-[color:var(--brand-500)] focus:ring-4 focus:ring-blue-500/10"
                />
              </div>
            </div>

            <div className="mt-6 border-t border-[color:var(--border)] pt-5">
              <p className="mb-3 text-xs font-semibold text-[color:var(--text-600)]">任务状态</p>
              <div className="space-y-1">
                {statusTabs.map((tab) => {
                  const active = statusGroup === tab.value;
                  return (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => setStatusGroup(tab.value)}
                      className={`flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-sm font-semibold transition-colors ${
                        active
                          ? 'bg-[color:var(--brand-50)] text-[color:var(--brand-700)]'
                          : 'text-[color:var(--text-600)] hover:bg-[color:var(--background-100)]'
                      }`}
                      aria-pressed={active}
                    >
                      {tab.label}
                      {active && <CheckCircle2 className="h-4 w-4 text-[color:var(--brand-500)]" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 border-t border-[color:var(--border)] pt-5">
              <p className="mb-3 text-xs font-semibold text-[color:var(--text-600)]">能力标签</p>
              {knownTags.length > 0 ? (
                <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
                  {knownTags.map((tag) => {
                    const active = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`min-h-11 max-w-full rounded-full px-3 text-xs font-semibold transition-colors ${
                          active
                            ? 'bg-[color:var(--brand-500)] text-white'
                            : 'bg-[color:var(--background-100)] text-[color:var(--text-600)] hover:bg-[color:var(--brand-50)] hover:text-[color:var(--brand-600)]'
                        }`}
                        aria-pressed={active}
                      >
                        <span className="block truncate">{tag}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs leading-5 text-[color:var(--text-500)]">加载任务后会显示可选标签。</p>
              )}
              <input
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
                placeholder="也可输入标签，逗号分隔"
                className="mt-3 h-11 w-full rounded-xl border border-[color:var(--border)] bg-white px-3 text-sm text-[color:var(--text-800)] outline-none transition-[border-color,box-shadow] placeholder:text-[color:var(--text-500)] focus:border-[color:var(--brand-500)] focus:ring-4 focus:ring-blue-500/10"
                aria-label="输入能力标签"
              />
            </div>

            <div className="mt-6 border-t border-[color:var(--border)] pt-5">
              <p className="mb-3 text-xs font-semibold text-[color:var(--text-600)]">预算范围</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="min-w-0">
                  <span className="sr-only">最低预算</span>
                  <input
                    type="number"
                    min="0"
                    value={minBudget}
                    onChange={(event) => setMinBudget(event.target.value)}
                    placeholder="最低"
                    className="h-11 w-full min-w-0 rounded-xl border border-[color:var(--border)] bg-white px-3 text-sm text-[color:var(--text-800)] outline-none transition-[border-color,box-shadow] placeholder:text-[color:var(--text-500)] focus:border-[color:var(--brand-500)] focus:ring-4 focus:ring-blue-500/10"
                  />
                </label>
                <label className="min-w-0">
                  <span className="sr-only">最高预算</span>
                  <input
                    type="number"
                    min="0"
                    value={maxBudget}
                    onChange={(event) => setMaxBudget(event.target.value)}
                    placeholder="最高"
                    className="h-11 w-full min-w-0 rounded-xl border border-[color:var(--border)] bg-white px-3 text-sm text-[color:var(--text-800)] outline-none transition-[border-color,box-shadow] placeholder:text-[color:var(--text-500)] focus:border-[color:var(--brand-500)] focus:ring-4 focus:ring-blue-500/10"
                  />
                </label>
              </div>
            </div>

            {hasFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--border)] text-sm font-semibold text-[color:var(--text-600)] transition-colors hover:border-[color:var(--brand-200)] hover:bg-[color:var(--brand-50)] hover:text-[color:var(--brand-600)]"
              >
                <RotateCcw className="h-4 w-4" />
                重置筛选
              </button>
            )}
          </div>
        </aside>

        <section className="min-w-0" aria-labelledby="task-market-results">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="task-market-results" className="text-lg font-bold text-[color:var(--text-800)]">
                {activeStatusLabel}
              </h2>
              <p className="mt-1 text-sm text-[color:var(--text-500)]">
                {loading
                  ? '正在同步任务'
                  : error
                    ? '暂未取得任务数据'
                    : `共找到 ${tasks.length} 个任务`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
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

              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                className="h-11 rounded-xl border border-[color:var(--border)] bg-white px-3 text-sm font-semibold text-[color:var(--text-600)] outline-none transition-[border-color,box-shadow] focus:border-[color:var(--brand-500)] focus:ring-4 focus:ring-blue-500/10"
                aria-label="任务排序方式"
              >
                <option value="newest">最新发布</option>
                <option value="budget_desc">预算最高</option>
                <option value="budget_asc">预算最低</option>
              </select>

              <button
                type="button"
                onClick={fetchTasks}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-[color:var(--border)] bg-white text-[color:var(--text-500)] transition-colors hover:border-[color:var(--brand-200)] hover:bg-[color:var(--brand-50)] hover:text-[color:var(--brand-600)]"
                aria-label="刷新任务列表"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="space-y-4" aria-label="正在加载任务列表">
              {Array.from({ length: 5 }, (_, index) => (
                <TaskSkeleton key={index} />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-2xl bg-[color:var(--state-error-surface)] px-6 py-12 text-center">
              <p className="font-semibold text-[color:var(--state-error)]">{error}</p>
              <button type="button" onClick={fetchTasks} className="btn-cs btn-primary mt-5">
                重新加载
              </button>
            </div>
          ) : tasks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[color:var(--background-400)] px-6 py-16 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--background-100)] text-[color:var(--text-500)]">
                <SearchX className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-base font-bold text-[color:var(--text-800)]">没有找到匹配的任务</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[color:var(--text-500)]">
                试试调整任务状态、能力标签或预算范围。
              </p>
              {hasFilter && (
                <button type="button" onClick={clearFilters} className="btn-cs btn-primary mt-6">
                  查看全部任务
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {tasks.map((task) => {
                const marketStatus = task.marketStatus || 'OPEN_FOR_BIDDING';
                const statusClass =
                  statusTone[marketStatus] ||
                  'bg-[color:var(--background-200)] text-[color:var(--text-600)]';
                const assignee =
                  task.selectedAgent?.name || task.selectedAgent?.id?.slice(0, 8) || '待定';
                const visibleTags = taskTags(task).slice(0, 5);
                const budget = task.dealPriceCny ?? task.budgetCny ?? 0;

                return (
                  <article
                    key={task.id}
                    className="group rounded-2xl border border-[color:var(--border)] bg-white p-5 transition-[border-color,box-shadow] hover:border-[color:var(--brand-200)] hover:shadow-[var(--shadow-sm)] md:p-6"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold ${statusClass}`}>
                            {task.marketStatusLabel || task.status || '招标中'}
                          </span>
                          <span className="font-mono text-xs text-[color:var(--text-500)]">
                            #{task.id.slice(0, 8)}
                          </span>
                        </div>
                        <h3 className="mt-3 line-clamp-1 text-lg font-bold text-[color:var(--text-900)] transition-colors group-hover:text-[color:var(--brand-600)]">
                          {task.title}
                        </h3>
                        {task.description && (
                          <p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-6 text-[color:var(--text-500)]">
                            {task.description}
                          </p>
                        )}
                      </div>

                      <div className="flex-shrink-0 sm:text-right">
                        <div className="text-xl font-bold text-[color:var(--text-900)]">
                          ¥{budget.toLocaleString('zh-CN')}
                        </div>
                        <div className="mt-1 text-xs text-[color:var(--text-500)]">
                          {task.dealPriceCny ? '成交价' : '任务预算'}
                        </div>
                      </div>
                    </div>

                    {visibleTags.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {visibleTags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleTag(tag)}
                            className="min-h-8 rounded-full bg-[color:var(--background-100)] px-2.5 text-xs font-medium text-[color:var(--text-600)] transition-colors hover:bg-[color:var(--brand-50)] hover:text-[color:var(--brand-600)]"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mt-5 grid gap-3 rounded-xl bg-[color:var(--background-100)] p-4 text-sm text-[color:var(--text-600)] sm:grid-cols-2 xl:grid-cols-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <CalendarClock className="h-4 w-4 flex-shrink-0 text-[color:var(--brand-500)]" />
                        <span className="truncate">交付：{formatShanghaiDateTime(task.expectedDeliveryAt)}</span>
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <UserCircle2 className="h-4 w-4 flex-shrink-0 text-[color:var(--icon-500)]" />
                        <span className="truncate">
                          任务方：{task.client?.phone || task.client?.id?.slice(0, 8) || '未知'}
                        </span>
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <Bot className="h-4 w-4 flex-shrink-0 text-[color:var(--icon-500)]" />
                        <span className="truncate">
                          {task.isAcceptingBids
                            ? `匹配 ${task.matchedAgents ?? 0} 个智能体`
                            : `执行智能体：${assignee}`}
                        </span>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 border-t border-[color:var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                      {task.isAcceptingBids ? (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                          <span className="flex items-center gap-2 text-[color:var(--text-600)]">
                            <CircleDollarSign className="h-4 w-4 text-[color:var(--brand-500)]" />
                            已有 <strong className="text-[color:var(--text-800)]">{task.bidsCount || 0}</strong> 个报价
                          </span>
                          {task.latestBid !== null && task.latestBid !== undefined && (
                            <span className="text-[color:var(--text-500)]">
                              当前最低 ¥{task.latestBid.toLocaleString('zh-CN')}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2 text-sm text-[color:var(--text-600)]">
                          <CheckCircle2 className="h-4 w-4 text-[color:var(--state-success-text)]" />
                          <span>执行智能体：{assignee}</span>
                          {task.orderStatus && (
                            <span className="text-[color:var(--text-500)]">· {task.orderStatus}</span>
                          )}
                        </div>
                      )}

                      <Link
                        to={`/tasks/${task.id}`}
                        className="inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-sm font-semibold text-[color:var(--brand-600)] transition-colors hover:bg-[color:var(--brand-50)] hover:text-[color:var(--brand-700)] sm:self-auto"
                      >
                        查看详情
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
