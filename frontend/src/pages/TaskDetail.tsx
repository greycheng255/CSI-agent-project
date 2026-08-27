import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  CheckCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Gauge,
  Hourglass,
  Loader2,
  Package,
  Paperclip,
  UserCircle2,
  XCircle,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';
import { BidDetailPanel } from '../components/BidDetailPanel';
import { formatShanghaiDateTime } from '../utils/date';

interface Task {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  budgetCny?: number;
  expectedDeliveryAt?: string;
  status: string;
  createdAt?: string;
  client?: { id: string; phone?: string };
  tags?: string[] | null;
  skillsRequired?: string[] | null;
  attachmentUrls?: string[] | null;
}

interface Order {
  id: string;
  status: 'PENDING_PAYMENT' | 'IN_PROGRESS' | 'DELIVERED' | 'ACCEPTED' | 'PENDING_RELEASE' | 'COMPLETED' | 'CANCELED' | 'REFUNDED';
  amountCny: number;
  createdAt: string;
  deliveredAt?: string;
  acceptedAt?: string;
  deliveryUrl?: string;
  deliverySummary?: string;
  bid?: {
    agent?: {
      id: string;
      name: string;
    };
    priceCny?: number;
  };
}

interface Agent {
  id: string;
  name: string;
}

interface Bid {
  id: string;
  priceCny: number;
  planSummary?: string;
  agent?: Agent;
  pricingModel?: string | null;
  createdAt?: string;
  status?: 'submitted' | 'accepted' | 'rejected' | 'expired' | 'withdrawn';
  confidenceScore?: number;
  estimatedHours?: number | null;
  riskNotes?: string | null;
  rankScore?: number;
  pricingMeta?: {
    scores?: {
      relevance?: number;
      complexity?: number;
      urgency?: number;
      overall?: number;
    };
    skillHits?: string[];
    params?: {
      minBidRatio?: number;
      maxBidRatio?: number;
      minScore?: number;
    };
    budgetCny?: number | null;
    ratio?: number | null;
    evaluation?: {
      baseRate: number;
      estimatedHours: number;
      basePrice: number;
      complexityFactor: number;
      complexity: string;
      complexityCn: string;
      confidence: string;
      minPrice: number;
      maxPrice: number;
      budgetCny: number;
      matchedSkills: Array<{
        name: string;
        description: string;
        matchScore: number;
      }>;
      executionPlan: string[];
      analysis?: string;
    };
  } | null;
}

/* eslint-disable react-hooks/exhaustive-deps -- task-related loaders are intentionally sequenced by task, order, and viewer effects */
export default function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const apiBase = API_BASE;
  const [task, setTask] = useState<Task | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectingBidId, setSelectingBidId] = useState<string | null>(null);
  const [expandedBidId, setExpandedBidId] = useState<string | null>(null);
  const canSelectBid = !!user && !!task?.client?.id && user.id === task.client.id && task.status === 'OPEN' && !order;

  const bidStatusView = (status?: Bid['status']) => {
    switch (status) {
      case 'accepted':
        return { label: '已中标', cls: 'bg-[color:var(--state-success-surface)] text-[color:var(--state-success-text)]' };
      case 'rejected':
        return { label: '未中标', cls: 'bg-[color:var(--background-200)] text-[color:var(--text-500)]' };
      case 'expired':
        return { label: '已过期', cls: 'bg-[color:var(--state-warning-surface)] text-[color:var(--state-warning)]' };
      case 'withdrawn':
        return { label: '已撤回', cls: 'bg-[color:var(--state-error-surface)] text-[color:var(--state-error)]' };
      case 'submitted':
      default:
        return { label: '待选择', cls: 'bg-[color:var(--brand-50)] text-[color:var(--brand-700)]' };
    }
  };

  const fetchBids = async (taskId: string) => {
    const res = await fetch(`${apiBase}/api/v1/tasks/${taskId}/bids`);
    if (!res.ok) throw new Error('获取报价失败');
    const data = await res.json();
    setBids(Array.isArray(data) ? data : []);
  };

  // 获取任务订单
  const fetchTaskOrder = async (taskId: string) => {
    try {
      const res = await fetch(`${apiBase}/api/v1/orders/task/${taskId}`);
      if (res.ok) {
        const orders = await res.json();
        if (Array.isArray(orders) && orders.length > 0) {
          setOrder(orders[0]);
        } else {
          setOrder(null);
        }
      }
    } catch {
      // 忽略错误
      setOrder(null);
    }
  };

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`${apiBase}/api/v1/tasks/${id}`).then(r => r.json()),
      fetch(`${apiBase}/api/v1/tasks/${id}/bids`).then(r => r.json()),
    ])
    .then(([taskData, bidsData]: [Task, Bid[]]) => {
      setTask(taskData || null);
      setBids(Array.isArray(bidsData) ? bidsData : []);
      // 获取任务订单
      fetchTaskOrder(id);
      setLoading(false);
    })
    .catch(() => {
      setTask(null);
      setBids([]);
      setLoading(false);
    });
  }, [apiBase, id]);

  useEffect(() => {
    if (!id) return;
    const status = task?.status;
    if (status !== 'OPEN') return;
    const timer = setInterval(() => {
      fetchBids(id).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [apiBase, id, task?.status]);

  const handleSelectBid = async (bidId: string) => {
    if (!user) {
      alert('请先登录');
      navigate('/login');
      return;
    }
    if (!task?.client?.id) {
      alert('该任务缺少雇主信息，无法选标');
      return;
    }
    if (user.id !== task.client.id) {
      alert('只有雇主才能选择报价');
      return;
    }
    setSelectingBidId(bidId);
    try {
      const res = await fetch(`${apiBase}/api/v1/tasks/${id}/select-bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bidId, userId: user.id }),
      });
      if (!res.ok) throw new Error('选标失败');
      const order = await res.json();
      alert('选标成功！即将跳转至支付页面...');
      navigate(`/orders/${order.id}?taskId=${id}`);
    } catch {
      alert('选标失败，请重试');
    } finally {
      setSelectingBidId(null);
    }
  };

  // 订单状态视图
  const orderStatusView = (status: Order['status']) => {
    switch (status) {
      case 'PENDING_PAYMENT':
        return { label: '待支付', badge: 'bg-[color:var(--state-warning-surface)] text-[color:var(--state-warning)]', icon: <Clock className="h-4 w-4" /> };
      case 'IN_PROGRESS':
        return { label: '进行中', badge: 'bg-[color:var(--brand-50)] text-[color:var(--brand-700)]', icon: <Loader2 className="h-4 w-4 animate-spin" /> };
      case 'DELIVERED':
        return { label: '待验收', badge: 'bg-[#f3efff] text-[#6544a5]', icon: <Package className="h-4 w-4" /> };
      case 'ACCEPTED':
        return { label: '已验收', badge: 'bg-[color:var(--state-success-surface)] text-[color:var(--state-success-text)]', icon: <CheckCircle className="h-4 w-4" /> };
      case 'PENDING_RELEASE':
        return { label: '待放款', badge: 'bg-[color:var(--state-warning-surface)] text-[color:var(--state-warning)]', icon: <Clock className="h-4 w-4" /> };
      case 'COMPLETED':
        return { label: '已完成', badge: 'bg-[color:var(--state-success-surface)] text-[color:var(--state-success-text)]', icon: <CheckCircle2 className="h-4 w-4" /> };
      case 'CANCELED':
        return { label: '已取消', badge: 'bg-[color:var(--background-200)] text-[color:var(--text-500)]', icon: <XCircle className="h-4 w-4" /> };
      case 'REFUNDED':
        return { label: '已退款', badge: 'bg-[color:var(--background-200)] text-[color:var(--text-500)]', icon: <XCircle className="h-4 w-4" /> };
      default:
        return { label: status, badge: 'bg-[color:var(--background-200)] text-[color:var(--text-500)]', icon: <Package className="h-4 w-4" /> };
    }
  };

  if (loading || !task) {
    return (
      <div className="w-full space-y-4 py-8" aria-label="正在加载任务详情">
        <div className="h-8 w-48 animate-pulse rounded bg-[color:var(--background-200)]" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="h-96 animate-pulse rounded-2xl bg-[color:var(--background-200)]" />
          <div className="h-72 animate-pulse rounded-2xl bg-[color:var(--background-200)]" />
        </div>
      </div>
    );
  }

  const taskStatusLabel = order?.status === 'COMPLETED'
    ? '已完成'
    : task.status === 'OPEN'
      ? '招标中'
      : task.status;

  return (
    <div className="w-full pb-10">
      <Link
        to="/market"
        className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-semibold text-[color:var(--brand-600)] transition-colors hover:text-[color:var(--brand-700)]"
      >
        <ArrowLeft className="h-4 w-4" />
        返回任务大厅
      </Link>

      <div className="mt-3 grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(360px,1fr)] xl:gap-6">
        <section className="min-w-0 self-start rounded-2xl border border-[color:var(--border)] bg-white px-5 py-6 md:px-7">
          <header className="border-b border-[color:var(--border)] pb-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-[color:var(--text-500)]">TASK#{task.id.slice(0, 12)}</span>
              <span className={`inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-xs font-semibold ${
                order?.status === 'COMPLETED'
                  ? 'bg-[color:var(--state-success-surface)] text-[color:var(--state-success-text)]'
                  : 'bg-[color:var(--brand-50)] text-[color:var(--brand-700)]'
              }`}>
                {order?.status === 'COMPLETED' && <CheckCircle2 className="h-3.5 w-3.5" />}
                {taskStatusLabel}
              </span>
            </div>
            <h1 className="max-w-4xl text-2xl font-bold tracking-tight text-[color:var(--text-900)] md:text-[28px]">
              {task.title}
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[color:var(--text-500)]">
              <span className="inline-flex items-center gap-1.5">
                <UserCircle2 className="h-4 w-4" />
                任务方 {task.client?.phone || task.client?.id?.slice(0, 8) || '未知'}
              </span>
              {order?.bid?.agent?.name && (
                <span className="inline-flex items-center gap-1.5">
                  <Bot className="h-4 w-4" />
                  执行者 {order.bid.agent.name}
                </span>
              )}
              {order && (
                <span>
                  成交价 <strong className="font-semibold text-[color:var(--text-700)]">¥{order.amountCny.toLocaleString('zh-CN')}</strong>
                </span>
              )}
            </div>
          </header>

          <div className="divide-y divide-[color:var(--border)]">
            <section className="py-6">
              <h2 className="text-base font-bold text-[color:var(--text-900)]">任务说明</h2>
              <p className="mt-3 max-w-4xl whitespace-pre-wrap text-sm leading-7 text-[color:var(--text-600)]">
                {task.description || '暂未提供任务描述。'}
              </p>
              {((task.tags && task.tags.length > 0) || (task.skillsRequired && task.skillsRequired.length > 0)) && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {task.tags?.map((tag) => (
                    <span key={tag} className="rounded-full bg-[color:var(--background-100)] px-2.5 py-1 text-xs text-[color:var(--text-600)]">
                      {tag}
                    </span>
                  ))}
                  {task.skillsRequired?.map((skill) => (
                    <span key={skill} className="rounded-full bg-[color:var(--brand-50)] px-2.5 py-1 text-xs font-medium text-[color:var(--brand-700)]">
                      {skill}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section className="py-6">
              <h2 className="flex items-center gap-2 text-base font-bold text-[color:var(--text-900)]">
                <CheckCircle2 className="h-4 w-4 text-[color:var(--state-success-text)]" />
                验收标准
              </h2>
              <p className="mt-3 max-w-4xl whitespace-pre-wrap text-sm leading-7 text-[color:var(--text-600)]">
                {task.acceptanceCriteria || '任务方暂未补充验收标准。'}
              </p>
            </section>

            {task.attachmentUrls && task.attachmentUrls.length > 0 && (
              <section className="py-6">
                <h2 className="flex items-center gap-2 text-base font-bold text-[color:var(--text-900)]">
                  <Paperclip className="h-4 w-4 text-[color:var(--brand-500)]" />
                  任务附件
                </h2>
                <div className="mt-3 divide-y divide-[color:var(--border)]">
                  {task.attachmentUrls.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-11 items-center gap-2 py-2 text-sm text-[color:var(--brand-600)] transition-colors hover:text-[color:var(--brand-700)]"
                    >
                      <ExternalLink className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate">{url}</span>
                    </a>
                  ))}
                </div>
              </section>
            )}

            <section className="py-6">
              <h2 className="flex items-center gap-2 text-base font-bold text-[color:var(--text-900)]">
                <CalendarClock className="h-4 w-4 text-[color:var(--brand-500)]" />
                任务时间
              </h2>
              <dl className="mt-4 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <dt className="text-xs text-[color:var(--text-500)]">发布时间</dt>
                  <dd className="mt-1 font-medium text-[color:var(--text-700)]">{formatShanghaiDateTime(task.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[color:var(--text-500)]">期望交付</dt>
                  <dd className="mt-1 font-medium text-[color:var(--text-700)]">{formatShanghaiDateTime(task.expectedDeliveryAt)}</dd>
                </div>
                {order?.deliveredAt && (
                  <div>
                    <dt className="text-xs text-[color:var(--text-500)]">实际交付</dt>
                    <dd className="mt-1 font-medium text-[color:var(--state-success-text)]">{formatShanghaiDateTime(order.deliveredAt)}</dd>
                  </div>
                )}
                {order?.acceptedAt && (
                  <div>
                    <dt className="text-xs text-[color:var(--text-500)]">验收通过</dt>
                    <dd className="mt-1 font-medium text-[color:var(--state-success-text)]">{formatShanghaiDateTime(order.acceptedAt)}</dd>
                  </div>
                )}
              </dl>
            </section>

            {task.status === 'OPEN' && !order && (
              <section className="py-6">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-base font-bold text-[color:var(--text-900)]">
                      <Bot className="h-4 w-4 text-[color:var(--brand-500)]" />
                      智能体报价
                    </h2>
                    <p className="mt-1 text-sm text-[color:var(--text-500)]">当前有 {bids.length} 个智能体参与竞标</p>
                  </div>
                </div>

                {!canSelectBid && (
                  <p className="mt-4 text-xs leading-6 text-[color:var(--text-500)]">
                    当前账号不是雇主，仅可查看报价；选择报价需使用雇主账号登录。
                  </p>
                )}

                {bids.length === 0 ? (
                  <div className="py-10 text-center">
                    <Bot className="mx-auto h-7 w-7 text-[color:var(--text-400)]" />
                    <h3 className="mt-3 font-semibold text-[color:var(--text-700)]">等待智能体报价</h3>
                    <p className="mt-1 text-sm text-[color:var(--text-500)]">任务正在向在线智能体广播，请稍后回来查看。</p>
                  </div>
                ) : (
                  <div className="mt-4 divide-y divide-[color:var(--border)] border-y border-[color:var(--border)]">
                    {bids.map((bid) => {
                      const statusView = bidStatusView(bid.status);
                      const canSelectThisBid = canSelectBid && (bid.status || 'submitted') === 'submitted';
                      return (
                        <article key={bid.id} className="py-5">
                          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="flex items-center font-bold text-[color:var(--text-800)]">
                                  <Bot className="mr-1 h-4 w-4 text-[color:var(--brand-500)]" />
                                  {bid.agent?.name || 'Unknown Agent'}
                                </span>
                                <span className="font-mono text-xs text-[color:var(--text-500)]">
                                  ID: {bid.agent?.id ? bid.agent.id.slice(0, 8) : '--------'}
                                </span>
                                <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold ${statusView.cls}`}>
                                  {statusView.label}
                                </span>
                                {bid.rankScore !== undefined && (
                                  <span className="inline-flex min-h-7 items-center rounded-full bg-[#f3efff] px-2.5 text-xs font-semibold text-[#6544a5]">
                                    排名分 {Math.round(bid.rankScore)}
                                  </span>
                                )}
                              </div>
                              <p className="mt-3 text-sm leading-6 text-[color:var(--text-600)]">
                                {bid.planSummary || '该智能体暂未提供补充说明。'}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-3 text-xs text-[color:var(--text-500)]">
                                <span className="flex items-center gap-1">
                                  <Gauge className="h-3.5 w-3.5" />
                                  置信度 {Math.round((bid.confidenceScore ?? 0.5) * 100)}%
                                </span>
                                {bid.estimatedHours !== null && bid.estimatedHours !== undefined && (
                                  <span className="flex items-center gap-1">
                                    <Hourglass className="h-3.5 w-3.5" />
                                    预估 {bid.estimatedHours} 小时
                                  </span>
                                )}
                                {bid.riskNotes && <span className="text-[color:var(--state-warning)]">风险：{bid.riskNotes}</span>}
                              </div>
                              <button
                                type="button"
                                onClick={() => setExpandedBidId((cur) => (cur === bid.id ? null : bid.id))}
                                className="mt-2 min-h-11 rounded-lg px-1 text-xs font-semibold text-[color:var(--brand-600)] hover:text-[color:var(--brand-700)]"
                              >
                                {expandedBidId === bid.id ? '收起报价依据' : '查看报价依据'}
                              </button>
                            </div>
                            <div className="flex shrink-0 items-center justify-between gap-4 md:min-w-[150px] md:flex-col md:items-end">
                              <div className="text-2xl font-bold text-[color:var(--text-900)]">¥{bid.priceCny.toLocaleString('zh-CN')}</div>
                              {canSelectBid && (
                                <button
                                  onClick={() => handleSelectBid(bid.id)}
                                  disabled={selectingBidId === bid.id || !canSelectThisBid}
                                  className="btn-cs btn-primary disabled:cursor-not-allowed disabled:opacity-50 md:w-full"
                                >
                                  {selectingBidId === bid.id ? <Loader2 className="h-4 w-4 animate-spin" /> : canSelectThisBid ? '选择该报价' : '不可选择'}
                                </button>
                              )}
                            </div>
                          </div>
                          {expandedBidId === bid.id && (
                            <div className="mt-4">
                              <BidDetailPanel bid={bid} />
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
          </div>
        </section>

        <aside className="self-start rounded-2xl border border-[color:var(--border)] bg-white px-5 py-6 md:px-6 lg:sticky lg:top-20">
          <section>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-[color:var(--text-500)]">最高预算</p>
                <p className="mt-1 text-3xl font-bold tracking-tight text-[color:var(--text-900)]">
                  ¥{(task.budgetCny ?? 0).toLocaleString('zh-CN')}
                </p>
              </div>
              <span className={`inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-xs font-semibold ${
                order?.status === 'COMPLETED'
                  ? 'bg-[color:var(--state-success-surface)] text-[color:var(--state-success-text)]'
                  : 'bg-[color:var(--brand-50)] text-[color:var(--brand-700)]'
              }`}>
                {order?.status === 'COMPLETED' && <CheckCircle2 className="h-3.5 w-3.5" />}
                {taskStatusLabel}
              </span>
            </div>
            <dl className="mt-5 divide-y divide-[color:var(--border)] border-y border-[color:var(--border)] text-sm">
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-[color:var(--text-500)]">任务方</dt>
                <dd className="min-w-0 truncate text-right font-semibold text-[color:var(--text-700)]">
                  {task.client?.phone || task.client?.id?.slice(0, 8) || '未知'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-[color:var(--text-500)]">期望交付</dt>
                <dd className="text-right font-semibold text-[color:var(--text-700)]">
                  {formatShanghaiDateTime(task.expectedDeliveryAt)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-[color:var(--text-500)]">收到报价</dt>
                <dd className="font-semibold text-[color:var(--text-700)]">{bids.length} 个</dd>
              </div>
            </dl>
          </section>

          <section className="pt-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-[color:var(--brand-500)]" />
                <h2 className="text-base font-bold text-[color:var(--text-900)]">关联订单</h2>
              </div>
              {order && (() => {
                const statusView = orderStatusView(order.status);
                return (
                  <span className={`inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-xs font-semibold ${statusView.badge}`}>
                    {statusView.icon}
                    {statusView.label}
                  </span>
                );
              })()}
            </div>

            {order ? (
              <>
                <dl className="mt-4 divide-y divide-[color:var(--border)] text-sm">
                  <div className="py-3">
                    <dt className="text-xs text-[color:var(--text-500)]">订单编号</dt>
                    <dd className="mt-1 truncate font-mono text-xs text-[color:var(--text-700)]">{order.id}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-3">
                    <dt className="text-[color:var(--text-500)]">成交价格</dt>
                    <dd className="font-bold text-[color:var(--text-900)]">¥{order.amountCny.toLocaleString('zh-CN')}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-3">
                    <dt className="text-[color:var(--text-500)]">执行智能体</dt>
                    <dd className="min-w-0 truncate text-right font-semibold text-[color:var(--text-700)]">
                      {order.bid?.agent?.name || '未知'}
                    </dd>
                  </div>
                  {order.acceptedAt && (
                    <div className="flex items-center justify-between gap-4 py-3">
                      <dt className="text-[color:var(--text-500)]">完成时间</dt>
                      <dd className="text-right font-semibold text-[color:var(--text-700)]">
                        {formatShanghaiDateTime(order.acceptedAt)}
                      </dd>
                    </div>
                  )}
                </dl>

                {order.deliveryUrl && (
                  <a
                    href={order.deliveryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 flex min-h-11 items-center gap-2 text-sm font-medium text-[color:var(--brand-600)] hover:text-[color:var(--brand-700)]"
                  >
                    <ExternalLink className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate">查看交付物</span>
                  </a>
                )}

                <Link to={`/orders/${order.id}?taskId=${task.id}`} className="btn-cs btn-primary mt-5 w-full">
                  {order.status === 'PENDING_PAYMENT'
                    ? '进入订单并支付'
                    : order.status === 'DELIVERED'
                      ? '进入订单并验收'
                      : '查看订单详情'}
                </Link>
              </>
            ) : (
              <p className="mt-3 text-sm leading-6 text-[color:var(--text-500)]">
                任务尚未选定执行智能体，选标后将在这里生成并展示关联订单。
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

