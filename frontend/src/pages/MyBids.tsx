import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, ChevronRight, CircleAlert, Clock, FileText, Inbox, Loader2, Package, RefreshCw, TrendingUp, X, XCircle } from 'lucide-react';
import { WorkbenchPageHeader, WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';

type BidStatus = 'ACTIVE' | 'EXPIRED' | 'ACCEPTED' | 'REJECTED';

type OrderItem = {
  id: string;
  bidId: string;
  status: string;
};

type BidItem = {
  id: string;
  taskId: string;
  task?: {
    id: string;
    title: string;
    description?: string;
    status?: string;
    budgetCny?: number;
  };
  agent?: {
    id: string;
    name: string;
  };
  priceCny: number;
  planSummary?: string;
  pricingMeta?: {
    evaluation?: {
      complexity?: string;
      complexityCn?: string;
      estimatedHours?: number;
      executionPlan?: string[];
      analysis?: string;
    };
  };
  createdAt: string;
  expiresAt?: string;
  status: BidStatus;
  order?: OrderItem;
};

function getBidStatus(bid: BidItem): BidStatus {
  // 如果报价已被选中（有关联订单），显示已中标
  if (bid.order && bid.order.bidId === bid.id) {
    return 'ACCEPTED';
  }
  // 如果报价已过期
  if (bid.expiresAt && new Date(bid.expiresAt) < new Date()) {
    return 'EXPIRED';
  }
  // 如果任务已关闭或取消，报价失效
  if (bid.task?.status === 'CLOSED' || bid.task?.status === 'CANCELED') {
    return 'EXPIRED';
  }
  return 'ACTIVE';
}

function bidStatusView(status: BidStatus) {
  switch (status) {
    case 'ACTIVE':
      return {
        label: '有效',
        badge: 'bg-[var(--state-success-surface)] text-[var(--state-success-text)] border border-[#bde9c9]',
        icon: <Clock className="w-4 h-4" />,
        description: '报价有效，等待雇主选择',
      };
    case 'EXPIRED':
      return {
        label: '已过期',
        badge: 'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]',
        icon: <XCircle className="w-4 h-4" />,
        description: '报价已过期或任务已结束',
      };
    case 'ACCEPTED':
      return {
        label: '已中标',
        badge: 'bg-[var(--brand-50)] text-[var(--brand-700)] border border-[var(--brand-200)]',
        icon: <CheckCircle className="w-4 h-4" />,
        description: '报价已被雇主接受',
      };
    case 'REJECTED':
      return {
        label: '未中标',
        badge: 'bg-[var(--state-error-surface)] text-[var(--state-error)] border border-[#ffc6c1]',
        icon: <XCircle className="w-4 h-4" />,
        description: '报价未被选择',
      };
    default:
      return {
        label: status,
        badge: 'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]',
        icon: <Package className="w-4 h-4" />,
        description: '',
      };
  }
}

/* eslint-disable react-hooks/exhaustive-deps -- bid refresh is intentionally driven by the authenticated account effect */
export default function MyBids() {
  const { token } = useAuthStore();
  const [bids, setBids] = useState<BidItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedBid, setSelectedBid] = useState<BidItem | null>(null);

  useEffect(() => {
    fetchMyBids();
  }, []);

  const fetchMyBids = async () => {
    try {
      setLoading(true);
      setError('');
      
      // 1. 先获取当前用户的 Agent 信息
      let agentId: string | null = null;
      try {
        const agentRes = await fetch(`${API_BASE}/api/v1/owner/agents/my`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        
        if (agentRes.ok) {
          const contentType = agentRes.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const agentData = await agentRes.json();
            agentId = agentData?.id || null;
          } else {
            const text = await agentRes.text();
            console.warn('Agent API 返回非 JSON:', text);
          }
        } else {
          const errorText = await agentRes.text();
          console.error('获取Agent信息失败:', agentRes.status, errorText);
        }
      } catch (agentErr) {
        console.error('获取Agent信息异常:', agentErr);
      }
      
      if (!agentId) {
        setBids([]);
        setLoading(false);
        return;
      }

      // 2. 获取该 Agent 的所有报价
      let bidsData: BidItem[] = [];
      try {
        const bidsRes = await fetch(`${API_BASE}/api/v1/agent/bids/agent/${agentId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (bidsRes.ok) {
          const contentType = bidsRes.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const jsonData = await bidsRes.json();
            bidsData = Array.isArray(jsonData) ? jsonData : [];
          } else {
            const text = await bidsRes.text();
            console.warn('Bids API 返回非 JSON:', text);
          }
        } else {
          const errorText = await bidsRes.text();
          console.error('获取报价记录失败:', bidsRes.status, errorText);
        }
      } catch (bidsErr) {
        console.error('获取报价记录异常:', bidsErr);
      }
      
      // 3. 获取该 Agent 的所有订单，用于判断报价是否被选中
      let ordersData: OrderItem[] = [];
      try {
        const ordersRes = await fetch(`${API_BASE}/api/v1/orders/agent/${agentId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        
        if (ordersRes.ok) {
          const contentType = ordersRes.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const jsonData = await ordersRes.json();
            ordersData = Array.isArray(jsonData) ? jsonData : [];
          }
        }
      } catch (ordersErr) {
        console.warn('获取订单信息失败:', ordersErr);
      }
      
      // 4. 将订单信息关联到报价，并计算状态
      const bidsWithStatus = bidsData.map((bid: BidItem) => {
        // 查找该报价对应的订单
        const relatedOrder = ordersData.find((order: OrderItem) => order.bidId === bid.id);
        const bidWithOrder = {
          ...bid,
          order: relatedOrder,
        };
        return {
          ...bidWithOrder,
          status: getBidStatus(bidWithOrder),
        };
      });
      
      setBids(bidsWithStatus);
    } catch (err) {
      console.error('加载报价失败:', err);
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatPrice = (price: number) => {
    return `¥${price.toLocaleString()}`;
  };

  // 统计信息
  const stats = {
    total: bids.length,
    active: bids.filter(b => b.status === 'ACTIVE').length,
    accepted: bids.filter(b => b.status === 'ACCEPTED').length,
    expired: bids.filter(b => b.status === 'EXPIRED').length,
    totalAmount: bids.reduce((sum, b) => sum + b.priceCny, 0),
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={TrendingUp}
        eyebrow="我的报价"
        title="报价记录"
        description="查看名下 Agent 对任务提交的报价、评估依据和中标结果。"
        actions={<button type="button" onClick={() => void fetchMyBids()} disabled={loading} className="btn-cs btn-ghost-dark btn-sm disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新</button>}
      />

      {loading && bids.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-white text-sm text-[var(--text-500)]"><Loader2 className="mr-3 h-5 w-5 animate-spin text-[var(--brand-500)]" />正在读取报价记录...</div>
      ) : error && bids.length === 0 ? (
        <WorkbenchStatePanel icon={CircleAlert} title="报价记录暂时无法加载" description={error} tone="error" action={<button type="button" onClick={() => void fetchMyBids()} className="btn-cs btn-primary btn-sm">重新加载</button>} />
      ) : (
        <>
          <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
            <div className="grid grid-cols-2 divide-x divide-y divide-[color:var(--border)] md:grid-cols-5 md:divide-y-0">
              {[
                { label: '全部报价', value: stats.total },
                { label: '有效报价', value: stats.active },
                { label: '已中标', value: stats.accepted },
                { label: '已过期', value: stats.expired },
                { label: '报价总额', value: formatPrice(stats.totalAmount) },
              ].map((item) => <div key={item.label} className="p-5"><p className="text-2xl font-bold tabular-nums text-[var(--text-900)]">{item.value}</p><p className="mt-1 text-xs text-[var(--text-500)]">{item.label}</p></div>)}
            </div>
          </section>

          {error && <div className="flex items-center gap-2 rounded-xl border border-[color:var(--state-error)] bg-[var(--state-error-surface)] px-4 py-3 text-sm text-[var(--state-error)]"><CircleAlert className="h-4 w-4" />刷新失败，当前仍展示已读取的记录。</div>}

          {bids.length === 0 ? (
            <WorkbenchStatePanel icon={Inbox} title="暂无报价记录" description="Agent 尚未对公开任务提交报价，可前往任务大厅寻找合适机会。" action={<Link to="/market" className="btn-cs btn-primary btn-sm"><TrendingUp className="h-4 w-4" />去任务大厅</Link>} />
          ) : (
            <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
              <div className="border-b border-[color:var(--border)] px-5 py-4"><h2 className="font-semibold text-[var(--text-800)]">全部报价</h2><p className="mt-1 text-xs text-[var(--text-500)]">按提交时间展示，点击查看完整定价依据</p></div>
              <div className="divide-y divide-[color:var(--border)]">
                {bids.map((bid) => {
                  const statusView = bidStatusView(bid.status);
                  return (
                    <article key={bid.id} className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_220px]">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${statusView.badge}`}>{statusView.icon}{statusView.label}</span><span className="text-xs text-[var(--text-400)]">{formatDate(bid.createdAt)}</span></div>
                        <Link to={`/tasks/${bid.taskId}`} className="mt-3 block truncate text-base font-semibold text-[var(--text-900)] hover:text-[var(--brand-600)]">{bid.task?.title || '未知任务'}</Link>
                        {bid.task?.description && <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--text-500)]">{bid.task.description}</p>}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {bid.pricingMeta?.evaluation?.complexityCn && <span className="rounded-lg bg-[var(--background-100)] px-2.5 py-1 text-xs text-[var(--text-600)]">复杂度：{bid.pricingMeta.evaluation.complexityCn}</span>}
                          {bid.pricingMeta?.evaluation?.estimatedHours && <span className="rounded-lg bg-[var(--background-100)] px-2.5 py-1 text-xs text-[var(--text-600)]">预估工时：{bid.pricingMeta.evaluation.estimatedHours} 小时</span>}
                        </div>
                        <p className="mt-3 line-clamp-2 text-sm text-[var(--text-500)]">{bid.planSummary || statusView.description}</p>
                      </div>
                      <div className="flex items-center justify-between gap-4 border-t border-[color:var(--border)] pt-4 lg:flex-col lg:items-end lg:justify-center lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0 lg:text-right">
                        <div><p className="text-xs text-[var(--text-500)]">报价金额</p><p className="mt-1 text-2xl font-bold tabular-nums text-[var(--text-900)]">{formatPrice(bid.priceCny)}</p>{bid.task?.budgetCny && <p className="mt-1 text-xs text-[var(--text-400)]">任务预算 {formatPrice(bid.task.budgetCny)}</p>}</div>
                        <button type="button" onClick={() => setSelectedBid(bid)} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[color:var(--border)] px-4 text-sm font-semibold text-[var(--text-700)] hover:border-[var(--brand-300)] hover:text-[var(--brand-600)]"><FileText className="h-4 w-4" />查看详情<ChevronRight className="h-4 w-4" /></button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {selectedBid && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-label="报价详情">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[color:var(--border)] bg-white">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[color:var(--border)] bg-white px-6 py-4"><div><h2 className="text-lg font-semibold text-[var(--text-900)]">报价详情</h2><p className="mt-1 text-xs text-[var(--text-500)]">提交于 {formatDate(selectedBid.createdAt)}</p></div><button type="button" onClick={() => setSelectedBid(null)} className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-500)] hover:bg-[var(--background-100)] hover:text-[var(--text-800)]" aria-label="关闭"><X className="h-5 w-5" /></button></div>
            <div className="space-y-6 p-6">
              <div><p className="text-xs font-semibold text-[var(--text-500)]">关联任务</p><Link to={`/tasks/${selectedBid.taskId}`} className="mt-2 block text-lg font-semibold text-[var(--brand-600)] hover:text-[var(--brand-700)]">{selectedBid.task?.title || '未知任务'}</Link>{selectedBid.task?.description && <p className="mt-2 text-sm leading-6 text-[var(--text-500)]">{selectedBid.task.description}</p>}</div>
              <div className="grid overflow-hidden rounded-xl border border-[color:var(--border)] sm:grid-cols-2 sm:divide-x sm:divide-[color:var(--border)]"><div className="p-4"><p className="text-xs text-[var(--text-500)]">报价金额</p><p className="mt-1 text-2xl font-bold text-[var(--text-900)]">{formatPrice(selectedBid.priceCny)}</p></div><div className="border-t border-[color:var(--border)] p-4 sm:border-t-0"><p className="mb-2 text-xs text-[var(--text-500)]">当前状态</p><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${bidStatusView(selectedBid.status).badge}`}>{bidStatusView(selectedBid.status).icon}{bidStatusView(selectedBid.status).label}</span></div></div>
              {selectedBid.pricingMeta?.evaluation && <div><h3 className="text-sm font-semibold text-[var(--text-800)]">评估信息</h3><dl className="mt-3 grid rounded-xl bg-[var(--background-100)] sm:grid-cols-2">{selectedBid.pricingMeta.evaluation.complexityCn && <div className="p-4"><dt className="text-xs text-[var(--text-500)]">复杂度</dt><dd className="mt-1 text-sm font-medium text-[var(--text-800)]">{selectedBid.pricingMeta.evaluation.complexityCn}</dd></div>}{selectedBid.pricingMeta.evaluation.estimatedHours && <div className="p-4"><dt className="text-xs text-[var(--text-500)]">预估工时</dt><dd className="mt-1 text-sm font-medium text-[var(--text-800)]">{selectedBid.pricingMeta.evaluation.estimatedHours} 小时</dd></div>}</dl></div>}
              {selectedBid.pricingMeta?.evaluation?.executionPlan?.length ? <div><h3 className="text-sm font-semibold text-[var(--text-800)]">执行计划</h3><ol className="mt-3 space-y-3">{selectedBid.pricingMeta.evaluation.executionPlan.map((step, index) => <li key={`${index}-${step}`} className="flex gap-3 text-sm leading-6 text-[var(--text-600)]"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-50)] text-xs font-semibold text-[var(--brand-600)]">{index + 1}</span>{step}</li>)}</ol></div> : null}
              {selectedBid.pricingMeta?.evaluation?.analysis && <div><h3 className="text-sm font-semibold text-[var(--text-800)]">详细分析</h3><p className="mt-3 whitespace-pre-wrap rounded-xl bg-[var(--background-100)] p-4 text-sm leading-6 text-[var(--text-600)]">{selectedBid.pricingMeta.evaluation.analysis}</p></div>}
              {selectedBid.planSummary && <div><h3 className="text-sm font-semibold text-[var(--text-800)]">报价说明</h3><p className="mt-2 text-sm leading-6 text-[var(--text-600)]">{selectedBid.planSummary}</p></div>}
              {selectedBid.expiresAt && <p className="text-xs text-[var(--text-400)]">有效期至：{formatDate(selectedBid.expiresAt)}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
