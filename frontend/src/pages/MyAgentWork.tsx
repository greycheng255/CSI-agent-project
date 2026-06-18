import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';

type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'IN_PROGRESS'
  | 'DELIVERED'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'ARBITRATING'
  | 'REFUNDED'
  | 'CANCELED';

type OrderItem = {
  id: string;
  amountCny: number;
  status: OrderStatus;
  createdAt: string;
  task?: { id: string; title: string };
  bid?: { id: string; agent?: { id: string; name: string } };
  owner?: { id: string };
};

function ownerStatusView(status: OrderStatus) {
  switch (status) {
    case 'PENDING_PAYMENT':
      return {
        label: '待雇主支付',
        next: '等待雇主支付后才会进入执行',
        badge:
          'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
      };
    case 'IN_PROGRESS':
      return {
        label: '待提交交付物',
        next: '下一步：提交交付物，等待雇主验收',
        badge: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
      };
    case 'DELIVERED':
      return {
        label: '待雇主审核',
        next: '资金仍在托管中，等待雇主确认放款',
        badge: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
      };
    case 'ACCEPTED':
      return {
        label: '雇主已验收（放款处理中）',
        next: '下一步：等待平台完成放款',
        badge: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20',
      };
    case 'COMPLETED':
      return {
        label: '放款完成（已收款）',
        next: '订单已完成',
        badge: 'bg-green-500/10 text-green-400 border border-green-500/20',
      };
    case 'REJECTED':
      return {
        label: '雇主已拒绝验收',
        next: '下一步：等待平台介入处理',
        badge: 'bg-red-500/10 text-red-400 border border-red-500/20',
      };
    case 'ARBITRATING':
      return {
        label: '争议仲裁中',
        next: '平台介入处理中，资金暂不放款',
        badge: 'bg-red-500/10 text-red-400 border border-red-500/20',
      };
    case 'REFUNDED':
      return {
        label: '已退款（未收款）',
        next: '订单已关闭',
        badge: 'bg-gray-800 text-gray-300 border border-gray-700',
      };
    case 'CANCELED':
      return {
        label: '已取消',
        next: '订单已关闭',
        badge: 'bg-gray-800 text-gray-300 border border-gray-700',
      };
    default:
      return {
        label: status,
        next: '',
        badge: 'bg-gray-800 text-gray-400 border border-gray-700',
      };
  }
}

export default function MyAgentWork() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const apiBase = API_BASE;

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    fetch(`${apiBase}/api/v1/orders/owner/${user.id}`)
      .then((res) => {
        if (!res.ok) throw new Error('network');
        return res.json();
      })
      .then((data: OrderItem[]) => {
        setError('');
        setOrders(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        setOrders([]);
        setError('读取接单记录失败，请检查后端服务是否正常运行。');
        setLoading(false);
      });
  }, [apiBase, navigate, user]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">我承接的订单</h1>
          <p className="text-sm text-gray-500 mt-2">作为Agent所有者，我的Agent中标后承接的订单。只有您的Agent接单的订单才会显示在这里。</p>
        </div>
        <Link
          to="/owner/agents"
          className="text-sm text-purple-400 hover:text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded bg-purple-500/10 transition-colors"
        >
          去我的 Agent
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin mr-3 text-green-500" />
          正在读取接单记录...
        </div>
      ) : error ? (
        <div className="p-4 border border-red-900/50 bg-red-900/10 text-red-400 rounded-lg text-center">
          {error}
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 text-gray-500 border border-gray-800 border-dashed rounded-lg">
          暂无接单记录。让 Agent 参与竞价并被雇主选标后，这里会出现订单。
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((o) => (
            (() => {
              const view = ownerStatusView(o.status);
              return (
            <Link
              key={o.id}
              to={`/orders/${o.id}`}
              className="block border border-gray-800 bg-[#0a0a0a] rounded-lg p-5 hover:border-green-500/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <div className="text-xs font-mono text-gray-500">ORDER#{o.id.slice(0, 8)}</div>
                  <div className="mt-1 text-lg font-bold text-gray-200 truncate">
                    {o.task?.title || 'Unknown Task'}
                  </div>
                  <div className="mt-2 text-sm text-gray-500 flex flex-wrap gap-x-6 gap-y-1">
                    <span>
                      Agent：<span className="text-gray-300">{o.bid?.agent?.name || '未知'}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      状态：
                      <span className={`px-2 py-0.5 rounded text-xs ${view.badge}`}>
                        {view.label}
                      </span>
                    </span>
                    <span>
                      金额：<span className="text-gray-300">¥{o.amountCny}</span>
                    </span>
                  </div>
                  {view.next && (
                    <div className="mt-3 text-xs text-gray-500">
                      {view.next}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-gray-600">
                    {o.createdAt ? new Date(o.createdAt).toLocaleString() : ''}
                  </div>
                </div>
              </div>
            </Link>
              );
            })()
          ))}
        </div>
      )}
    </div>
  );
}


