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

/** 任务大厅展示对象 = marketplace_tasks（长任务竞标池）字段投影 */
interface Task {
  id: string;
  title: string;
  description?: string | null;
  categoryId?: string | null;
  budgetMinCny?: number | null;
  budgetMaxCny?: number | null;
  expectedDeliveryAt?: string | null;
  attachmentUrls?: string[] | null;
  tags?: string[] | null;
  status: string;
  seatLimit: number;
  seatTaken: number;
  employerUserId?: string | null;
  expiresAt?: string | null;
  createdAt?: string;
}

/** 预算展示：区间 / 上限 / 面议 */
function budgetRangeCny(task: Task) {
  const { budgetMinCny: min, budgetMaxCny: max } = task;
  if (min != null && max != null) return `¥${min.toLocaleString('zh-CN')} - ¥${max.toLocaleString('zh-CN')}`;
  if (max != null) return `≤ ¥${max.toLocaleString('zh-CN')}`;
  if (min != null) return `≥ ¥${min.toLocaleString('zh-CN')}`;
  return '预算面议';
}

/** 预算排序键（无区间时用存在的一端，缺省为 0） */
function budgetSortKey(task: Task) {
  return task.budgetMaxCny ?? task.budgetMinCny ?? 0;
}

const statusTabs: Array<{ value: StatusGroup; label: string }> = [
  { value: 'all', label: '全部任务' },
  { value: 'bidding', label: '招标中' },
  { value: 'executing', label: '执行中' },
  { value: 'completed', label: '已完成' },
  { value: 'abnormal', label: '异常任务' },
];

const splitList = (value: string) =>
  value
    .split(/[,，\s]/)
    .map((item) => item.trim())
    .filter(Boolean);

function taskTags(task: Task) {
  return Array.from(new Set(task.tags || [])).filter(Boolean);
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

  const fetchTasks = useCallback(() => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoading(true);
    setError('');

    // 任务大厅读取 marketplace_tasks 公开任务池（雇主发布后在此可见）
    requestTaskMarket(`${apiBase}/api/v1/longtask/marketplace-tasks`, controller.signal)
      .then((response) => {
        const raw = (Array.isArray(response.data) ? response.data : response) as Task[];
        const kw = keyword.trim().toLowerCase();
        const minB = minBudget ? Number(minBudget) : null;
        const maxB = maxBudget ? Number(maxBudget) : null;

        let next = raw.filter((t) => {
          if (kw && !`${t.title} ${t.description || ''}`.toLowerCase().includes(kw)) {
            return false;
          }
          if (selectedTags.length > 0) {
            const tags = taskTags(t);
            if (!selectedTags.every((tag) => tags.includes(tag))) return false;
          }
          // 预算区间相交过滤
          if (minB != null && (t.budgetMaxCny ?? Number.POSITIVE_INFINITY) < minB) return false;
          if (maxB != null && (t.budgetMinCny ?? 0) > maxB) return false;
          return true;
        });

        // marketplace 任务均为招标中；executing/completed/abnormal 暂不划分，结果为空
        if (statusGroup !== 'all' && statusGroup !== 'bidding') {
          next = [];
        }

        switch (sortBy) {
          case 'budget_desc':
            next = [...next].sort((a, b) => budgetSortKey(b) - budgetSortKey(a));
            break;
          case 'budget_asc':
            next = [...next].sort((a, b) => budgetSortKey(a) - budgetSortKey(b));
            break;
          default:
            next = [...next].sort(
              (a, b) =>
                new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
            );
        }

        setTasks(next);
        const nextTags = next.flatMap(taskTags);
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
  }, [apiBase, keyword, maxBudget, minBudget, selectedTags, sortBy, statusGroup]);

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
                const visibleTags = taskTags(task).slice(0, 5);
                const seatLeft = Math.max(0, (task.seatLimit ?? 0) - (task.seatTaken ?? 0));
                const openForBid = task.status === 'open';

                return (
                  <article
                    key={task.id}
                    className="group rounded-2xl border border-[color:var(--border)] bg-white p-5 transition-[border-color,box-shadow] hover:border-[color:var(--brand-200)] hover:shadow-[var(--shadow-sm)] md:p-6"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold bg-[color:var(--brand-50)] text-[color:var(--brand-700)]">
                            {openForBid ? '招标中' : '已截止'}
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
                        <div className="text-sm font-bold text-[color:var(--text-900)]">
                          {budgetRangeCny(task)}
                        </div>
                        <div className="mt-1 text-xs text-[color:var(--text-500)]">
                          预算区间
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
                        <span className="truncate">发布于 {formatShanghaiDateTime(task.createdAt)}</span>
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <Bot className="h-4 w-4 flex-shrink-0 text-[color:var(--icon-500)]" />
                        <span className="truncate">
                          类别：{task.categoryId || '不限'}
                        </span>
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <UserCircle2 className="h-4 w-4 flex-shrink-0 text-[color:var(--icon-500)]" />
                        <span className="truncate">
                          竞标席位 {task.seatTaken ?? 0}/{task.seatLimit ?? 0} 已占
                        </span>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 border-t border-[color:var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                        {openForBid ? (
                          <>
                            <span className="flex items-center gap-2 text-[color:var(--text-600)]">
                              <CircleDollarSign className="h-4 w-4 text-[color:var(--brand-500)]" />
                              开放竞标，剩余 <strong className="text-[color:var(--text-800)]">{seatLeft}</strong> 席
                            </span>
                            <span className="text-[color:var(--text-500)]">
                              {task.expiresAt
                                ? `截止 ${formatShanghaiDateTime(task.expiresAt)}`
                                : '长期开放'}
                            </span>
                          </>
                        ) : (
                          <span className="flex items-center gap-2 text-[color:var(--text-500)]">
                            <CheckCircle2 className="h-4 w-4 text-[color:var(--state-success-text)]" />
                            该任务已截止竞标
                          </span>
                        )}
                      </div>

                      <Link
                        to={`/longtask/tasks/${task.id}/seats`}
                        className="inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-sm font-semibold text-[color:var(--brand-600)] transition-colors hover:bg-[color:var(--brand-50)] hover:text-[color:var(--brand-700)] sm:self-auto"
                      >
                        查看竞标详情
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
