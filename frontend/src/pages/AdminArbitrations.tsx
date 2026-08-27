import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleAlert, Inbox, Loader2, Gavel, CheckCircle2, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';
import { WorkbenchPageHeader, WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';

type ArbitrationStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
type ArbitrationResolution = 'REFUND' | 'PAYOUT';

type ArbitrationItem = {
  id: string;
  status: ArbitrationStatus;
  reason?: string | null;
  createdAt: string;
  order?: {
    id: string;
    status: string;
    amountCny: number;
    task?: { id: string; title?: string };
    client?: { id: string; phone?: string };
    owner?: { id: string; phone?: string };
    bid?: { agent?: { id: string; name?: string } };
  };
};

export default function AdminArbitrations() {
  const { admin, adminToken } = useAuthStore();
  const navigate = useNavigate();
  const apiBase = API_BASE;

  const [items, setItems] = useState<ArbitrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<'all' | ArbitrationStatus>('all');
  const [error, setError] = useState('');

  const fetchList = useCallback((status?: ArbitrationStatus) => {
    setLoading(true);
    setError('');
    const qs = status ? `?status=${status}` : '';
    fetch(`${apiBase}/api/v1/admin/arbitrations${qs}`, {
      headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : undefined,
    })
      .then((r) => r.json())
      .then((data) => {
        setItems(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        setItems([]);
        setError('仲裁列表暂时无法加载，请检查服务状态后重试。');
        setLoading(false);
      });
  }, [apiBase, adminToken]);

  useEffect(() => {
    if (!admin) {
      navigate('/login');
      return;
    }
    fetchList();
  }, [fetchList, navigate, admin]);

  const changeStatus = (status: 'all' | ArbitrationStatus) => {
    setActiveStatus(status);
    fetchList(status === 'all' ? undefined : status);
  };

  const start = async (orderId: string) => {
    if (!admin || !adminToken) return;
    setActingId(orderId);
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/arbitrations/${orderId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.message || '接手失败');
      }
    } finally {
      setActingId(null);
      fetchList();
    }
  };

  const resolve = async (orderId: string, resolution: ArbitrationResolution) => {
    if (!admin || !adminToken) return;
    setActingId(orderId);
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/arbitrations/${orderId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ resolution }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.message || '裁决失败');
      }
    } finally {
      setActingId(null);
      fetchList();
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={Gavel}
        eyebrow="仲裁管理"
        title="订单争议处理"
        description="处理被拒绝或进入仲裁的订单，核对争议原因后决定退款或向 Agent 放款。"
        actions={<button type="button" onClick={() => fetchList(activeStatus === 'all' ? undefined : activeStatus)} disabled={loading} className="btn-cs btn-ghost-dark btn-sm disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新列表</button>}
      />

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-[var(--background-100)] p-1">
        {[
          { key: 'all', label: '全部' },
          { key: 'OPEN', label: '待接手' },
          { key: 'IN_PROGRESS', label: '处理中' },
          { key: 'RESOLVED', label: '已结案' },
        ].map((item) => <button key={item.key} type="button" onClick={() => changeStatus(item.key as 'all' | ArbitrationStatus)} className={`min-h-10 shrink-0 rounded-lg px-4 text-sm font-medium transition-colors ${activeStatus === item.key ? 'bg-white text-[var(--brand-700)] shadow-sm' : 'text-[var(--text-500)] hover:text-[var(--text-800)]'}`}>{item.label}</button>)}
      </div>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-white text-sm text-[var(--text-500)]">
          <Loader2 className="mr-3 h-5 w-5 animate-spin text-[var(--brand-500)]" />
          正在加载仲裁列表...
        </div>
      ) : error ? (
        <WorkbenchStatePanel icon={CircleAlert} title="仲裁列表暂时无法加载" description={error} tone="error" action={<button type="button" onClick={() => fetchList(activeStatus === 'all' ? undefined : activeStatus)} className="btn-cs btn-primary btn-sm">重新加载</button>} />
      ) : items.length === 0 ? (
        <WorkbenchStatePanel icon={Inbox} title="当前没有仲裁记录" description="新的订单争议出现后，会进入对应状态的处理队列。" />
      ) : (
        <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
          <div className="border-b border-[color:var(--border)] px-5 py-4"><h2 className="font-semibold text-[var(--text-800)]">争议队列</h2><p className="mt-1 text-xs text-[var(--text-500)]">当前共 {items.length} 条记录</p></div>
          <div className="divide-y divide-[color:var(--border)]">
          {items.map((a) => {
            const order = a.order;
            const orderId = order?.id || '';
            return (
              <article key={a.id} className="p-5 transition-colors hover:bg-[var(--background-100)]">
                <div className="flex justify-between items-start gap-4">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-[var(--text-400)]">ARB#{a.id.slice(0, 8)} · ORDER#{orderId.slice(0, 8)}</div>
                    <div className="mt-2 truncate text-base font-semibold text-[var(--text-900)]">
                      {order?.task?.title || `TASK#${order?.task?.id?.slice(0, 8)}`}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-[var(--text-500)]">
                      <span>金额：<span className="font-medium text-[var(--text-800)]">¥{order?.amountCny ?? 0}</span></span>
                      <span>Agent：<span className="font-medium text-[var(--text-800)]">{order?.bid?.agent?.name || '未知'}</span></span>
                      <span>订单状态：<span className="text-[var(--text-700)]">{order?.status}</span></span>
                      <span>仲裁状态：<span className="text-[var(--text-700)]">{a.status}</span></span>
                    </div>
                    {a.reason && (
                      <div className="mt-3 whitespace-pre-wrap rounded-xl bg-[var(--background-100)] p-3 text-xs leading-5 text-[var(--text-600)]">
                        {a.reason}
                      </div>
                    )}
                    <div className="mt-2 text-xs text-[var(--text-400)]">
                      {a.createdAt ? new Date(a.createdAt).toLocaleString() : ''}
                    </div>
                  </div>

                  <div className="shrink-0 flex flex-col gap-2">
                    {orderId && (
                      <button
                        type="button"
                        onClick={() => navigate(`/orders/${orderId}`)}
                        className="min-h-10 rounded-full border border-[color:var(--border)] px-4 text-sm font-medium text-[var(--text-600)] hover:border-[var(--brand-300)] hover:text-[var(--brand-600)]"
                      >
                        查看订单
                      </button>
                    )}

                    {a.status === 'OPEN' && orderId && (
                      <button
                        type="button"
                        onClick={() => start(orderId)}
                        disabled={actingId === orderId}
                        className="btn-cs btn-primary btn-sm disabled:opacity-50"
                      >
                        {actingId === orderId ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        接手处理
                      </button>
                    )}

                    {a.status === 'IN_PROGRESS' && orderId && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => resolve(orderId, 'REFUND')}
                          disabled={actingId === orderId}
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[var(--state-error)] px-4 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {actingId === orderId ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          退款给雇主
                        </button>
                        <button
                          type="button"
                          onClick={() => resolve(orderId, 'PAYOUT')}
                          disabled={actingId === orderId}
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[var(--state-success)] px-4 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {actingId === orderId ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          放款给Agent
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
          </div>
        </section>
      )}
    </div>
  );
}
