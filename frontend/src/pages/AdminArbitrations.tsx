import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Gavel, CheckCircle2, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';

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

  const fetchList = useCallback((status?: ArbitrationStatus) => {
    setLoading(true);
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
        setLoading(false);
      });
  }, [apiBase, adminToken]);

  useEffect(() => {
    if (!admin) {
      navigate('/admin/login');
      return;
    }
    fetchList();
  }, [fetchList, navigate, admin]);

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
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-2xl font-bold text-gray-200 flex items-center gap-2">
            <Gavel className="w-6 h-6 text-yellow-500" />
            仲裁后台
          </div>
          <div className="text-sm text-gray-500 mt-1">对 REJECTED/ARBITRATING 订单进行处理：退款或放款。</div>
        </div>
        <button
          type="button"
          onClick={() => fetchList()}
          className="px-3 py-2 border border-gray-700 rounded text-sm text-gray-300 hover:border-gray-500 flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          刷新
        </button>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => fetchList()}
          className="px-3 py-2 border border-gray-700 rounded text-sm text-gray-300 hover:border-gray-500"
        >
          全部
        </button>
        <button
          type="button"
          onClick={() => fetchList('OPEN')}
          className="px-3 py-2 border border-gray-700 rounded text-sm text-gray-300 hover:border-gray-500"
        >
          待接手
        </button>
        <button
          type="button"
          onClick={() => fetchList('IN_PROGRESS')}
          className="px-3 py-2 border border-gray-700 rounded text-sm text-gray-300 hover:border-gray-500"
        >
          处理中
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin mr-3 text-yellow-500" />
          正在加载仲裁列表...
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 text-gray-500 border border-gray-800 border-dashed rounded-xl">
          暂无仲裁记录。
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((a) => {
            const order = a.order;
            const orderId = order?.id || '';
            return (
              <div key={a.id} className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-5">
                <div className="flex justify-between items-start gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-gray-500">ARB#{a.id.slice(0, 8)} · ORDER#{orderId.slice(0, 8)}</div>
                    <div className="mt-1 text-lg font-bold text-gray-200 truncate">
                      {order?.task?.title || `TASK#${order?.task?.id?.slice(0, 8)}`}
                    </div>
                    <div className="mt-2 text-sm text-gray-500 flex flex-wrap gap-x-6 gap-y-1">
                      <span>金额：<span className="text-gray-300">¥{order?.amountCny ?? 0}</span></span>
                      <span>Agent：<span className="text-gray-300">{order?.bid?.agent?.name || '未知'}</span></span>
                      <span>订单状态：<span className="text-gray-300">{order?.status}</span></span>
                      <span>仲裁状态：<span className="text-gray-300">{a.status}</span></span>
                    </div>
                    {a.reason && (
                      <div className="mt-3 text-xs text-gray-400 whitespace-pre-wrap border border-gray-800 rounded-lg p-3 bg-black/40">
                        {a.reason}
                      </div>
                    )}
                    <div className="mt-2 text-xs text-gray-600">
                      {a.createdAt ? new Date(a.createdAt).toLocaleString() : ''}
                    </div>
                  </div>

                  <div className="shrink-0 flex flex-col gap-2">
                    {orderId && (
                      <button
                        type="button"
                        onClick={() => navigate(`/orders/${orderId}`)}
                        className="px-3 py-2 border border-gray-700 rounded text-sm text-gray-300 hover:border-gray-500"
                      >
                        查看订单
                      </button>
                    )}

                    {a.status === 'OPEN' && orderId && (
                      <button
                        type="button"
                        onClick={() => start(orderId)}
                        disabled={actingId === orderId}
                        className="px-3 py-2 bg-yellow-500 text-black font-bold rounded hover:bg-yellow-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
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
                          className="px-3 py-2 bg-red-500 text-white font-bold rounded hover:bg-red-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                        >
                          {actingId === orderId ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          退款给雇主
                        </button>
                        <button
                          type="button"
                          onClick={() => resolve(orderId, 'PAYOUT')}
                          disabled={actingId === orderId}
                          className="px-3 py-2 bg-green-500 text-black font-bold rounded hover:bg-green-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                        >
                          {actingId === orderId ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          放款给Agent
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
