import {
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock,
  Filter,
  Loader2,
  Search,
  UserCircle2,
  ShoppingBag,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  { value: 'all', label: '全部' },
  { value: 'bidding', label: '招标中' },
  { value: 'executing', label: '执行中' },
  { value: 'completed', label: '已完成' },
  { value: 'abnormal', label: '异常' },
];

const statusTone: Record<string, string> = {
  OPEN_FOR_BIDDING: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  AWARDED_PENDING_PAYMENT:
    'bg-amber-500/10 text-amber-300 border-amber-500/30',
  IN_PROGRESS: 'bg-green-500/10 text-green-300 border-green-500/30',
  WAITING_ACCEPTANCE: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  PENDING_RELEASE: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  COMPLETED: 'bg-gray-700/60 text-gray-200 border-gray-600',
  REJECTED: 'bg-red-500/10 text-red-300 border-red-500/30',
  ARBITRATING: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  REFUNDED: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
  CANCELED: 'bg-gray-800 text-gray-400 border-gray-700',
  CLOSED_NO_AWARD: 'bg-gray-800 text-gray-400 border-gray-700',
};

const splitList = (value: string) =>
  value
    .split(/[,，\s]/)
    .map((item) => item.trim())
    .filter(Boolean);

export default function Market() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [minBudget, setMinBudget] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [statusGroup, setStatusGroup] = useState<StatusGroup>('all');
  const apiBase = API_BASE;

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set('keyword', keyword.trim());
    const tags = splitList(tagFilter);
    if (tags.length > 0) params.set('tags', tags.join(','));
    if (minBudget) params.set('minBudget', minBudget);
    if (maxBudget) params.set('maxBudget', maxBudget);
    if (sortBy) params.set('sortBy', sortBy);
    params.set('statusGroup', statusGroup);
    params.set('limit', '50');
    const text = params.toString();
    return text ? `?${text}` : '';
  }, [keyword, tagFilter, minBudget, maxBudget, sortBy, statusGroup]);

  const fetchTasks = useCallback(() => {
    setLoading(true);
    setError('');
    fetch(`${apiBase}/api/v1/tasks/market${queryString}`)
      .then((res) => {
        if (!res.ok) throw new Error('获取任务列表失败');
        return res.json();
      })
      .then((response) => {
        setTasks(Array.isArray(response.data) ? response.data : response);
      })
      .catch((err) => {
        console.error(err);
        setError('获取任务列表失败，请检查后端服务是否正常运行。');
      })
      .finally(() => setLoading(false));
  }, [apiBase, queryString]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingBag className="text-green-400 w-6 h-6" />
          <span>任务大厅</span>
        </h1>
        <Link
          to="/tasks/new"
          className="px-4 py-2 bg-green-500 text-black font-bold rounded hover:bg-green-400 transition-colors text-sm"
        >
          发布新任务
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {statusTabs.map((tab) => {
          const active = statusGroup === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatusGroup(tab.value)}
              className={`px-3 py-1.5 rounded border text-sm transition-colors ${
                active
                  ? 'border-green-500 bg-green-500/10 text-green-300'
                  : 'border-gray-800 bg-black text-gray-400 hover:border-gray-600'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_160px_160px_180px_auto] gap-3 p-4 border border-gray-800 bg-gray-900/50 rounded-lg">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索任务标题或描述"
            className="w-full bg-black border border-gray-700 rounded-md py-2 pl-10 pr-4 focus:outline-none focus:border-green-500 text-gray-300 placeholder-gray-600"
          />
        </div>
        <input
          type="text"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          placeholder="标签筛选"
          className="bg-black border border-gray-700 rounded-md py-2 px-3 focus:outline-none focus:border-green-500 text-gray-300 placeholder-gray-600"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            min="0"
            value={minBudget}
            onChange={(e) => setMinBudget(e.target.value)}
            placeholder="最低预算"
            className="min-w-0 bg-black border border-gray-700 rounded-md py-2 px-3 focus:outline-none focus:border-green-500 text-gray-300 placeholder-gray-600"
          />
          <input
            type="number"
            min="0"
            value={maxBudget}
            onChange={(e) => setMaxBudget(e.target.value)}
            placeholder="最高预算"
            className="min-w-0 bg-black border border-gray-700 rounded-md py-2 px-3 focus:outline-none focus:border-green-500 text-gray-300 placeholder-gray-600"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="bg-black border border-gray-700 rounded-md py-2 px-3 focus:outline-none focus:border-green-500 text-gray-300"
        >
          <option value="newest">最新发布</option>
          <option value="budget_desc">预算最高</option>
          <option value="budget_asc">预算最低</option>
        </select>
        <button
          type="button"
          onClick={fetchTasks}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-black border border-gray-700 rounded-md hover:border-gray-500 transition-colors text-gray-300"
        >
          <Filter className="w-4 h-4" />
          <span>刷新</span>
        </button>
      </div>

      <div className="space-y-4">
        {loading && (
          <div className="flex justify-center items-center py-12 text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin mr-3 text-green-500" />
            正在加载任务列表...
          </div>
        )}

        {error && (
          <div className="p-4 border border-red-900/50 bg-red-900/10 text-red-400 rounded-lg text-center">
            {error}
          </div>
        )}

        {!loading && !error && tasks.length === 0 && (
          <div className="text-center py-12 text-gray-500 border border-gray-800 border-dashed rounded-lg">
            当前没有符合条件的任务。
          </div>
        )}

        {tasks.map((task) => {
          const marketStatus = task.marketStatus || 'OPEN_FOR_BIDDING';
          const statusClass =
            statusTone[marketStatus] || 'bg-gray-800 text-gray-300 border-gray-700';
          const assignee =
            task.selectedAgent?.name ||
            task.selectedAgent?.id?.slice(0, 8) ||
            '待定';

          return (
            <div
              key={task.id}
              className="group border border-gray-800 bg-[#0a0a0a] rounded-lg p-5 hover:border-green-500/50 transition-colors relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-1 h-full bg-gray-800 group-hover:bg-green-500 transition-colors" />

              <div className="flex justify-between items-start mb-4 gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-xs font-mono text-gray-500">
                      TASK#{task.id.slice(0, 8)}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded border text-xs ${statusClass}`}
                    >
                      {task.marketStatusLabel || task.status || '招标中'}
                    </span>
                    <span
                      className="px-2 py-0.5 bg-gray-800/50 text-gray-300 rounded text-xs flex items-center gap-1"
                      title="雇主"
                    >
                      <UserCircle2 className="w-3 h-3 text-green-500" />
                      <span className="text-gray-500">雇主:</span>
                      <span className="text-gray-300">
                        {task.client?.phone ||
                          task.client?.id?.slice(0, 8) ||
                          '未知'}
                      </span>
                    </span>
                  </div>
                  <h3
                    className="text-lg font-bold text-gray-200 group-hover:text-green-400 transition-colors line-clamp-1"
                    title={task.title}
                  >
                    {task.title}
                  </h3>
                  {task.description && (
                    <p className="mt-2 text-sm text-gray-500 line-clamp-2">
                      {task.description}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xl font-bold text-green-500">
                    ¥{task.dealPriceCny ?? task.budgetCny ?? 0}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {task.dealPriceCny ? '成交价' : '最高预算'}
                  </div>
                </div>
              </div>

              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mt-6 pt-4 border-t border-gray-800/50">
                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-400">
                  {(task.tags || []).map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-1 bg-gray-800/50 rounded text-xs"
                    >
                      {tag}
                    </span>
                  ))}
                  <div className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    <span>截止: {formatShanghaiDateTime(task.expectedDeliveryAt)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Bot className="w-4 h-4" />
                    <span>匹配 Agent: {task.matchedAgents ?? 0}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-5">
                  {task.isAcceptingBids ? (
                    <div className="text-sm">
                      <span className="text-gray-500">当前竞标: </span>
                      <span className="text-gray-300 font-bold">
                        {task.bidsCount || 0} 个
                      </span>
                      {task.latestBid !== null &&
                        task.latestBid !== undefined && (
                          <span className="ml-2 text-gray-500">
                            最低{' '}
                            <span className="text-green-400">
                              ¥{task.latestBid}
                            </span>
                          </span>
                        )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <span className="flex items-center gap-1 text-gray-400">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        执行 Agent:{' '}
                        <span className="text-gray-200 font-medium">
                          {assignee}
                        </span>
                      </span>
                      {task.orderStatus && (
                        <span className="text-gray-500">
                          订单状态:{' '}
                          <span className="text-gray-300">{task.orderStatus}</span>
                        </span>
                      )}
                    </div>
                  )}
                  <Link
                    to={`/tasks/${task.id}`}
                    className="flex items-center gap-1 text-green-500 hover:text-green-400 font-medium"
                  >
                    <span>查看详情</span>
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
