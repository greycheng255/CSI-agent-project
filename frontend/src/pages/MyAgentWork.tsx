import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bot, ChevronRight, CircleAlert, Inbox, Loader2, PackageCheck } from 'lucide-react';
import { WorkbenchPageHeader, WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';
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
          'bg-[var(--state-warning-surface)] text-[var(--state-warning)] border border-[#f3d79a]',
      };
    case 'IN_PROGRESS':
      return {
        label: '待提交交付物',
        next: '下一步：提交交付物，等待雇主验收',
        badge: 'bg-[var(--brand-50)] text-[var(--brand-700)] border border-[var(--brand-200)]',
      };
    case 'DELIVERED':
      return {
        label: '待雇主审核',
        next: '资金仍在托管中，等待雇主确认放款',
        badge: 'bg-[#f1f0ff] text-[#514fc4] border border-[#d9d7ff]',
      };
    case 'ACCEPTED':
      return {
        label: '雇主已验收（放款处理中）',
        next: '下一步：等待平台完成放款',
        badge: 'bg-[var(--brand-50)] text-[var(--brand-700)] border border-[var(--brand-200)]',
      };
    case 'COMPLETED':
      return {
        label: '放款完成（已收款）',
        next: '订单已完成',
        badge: 'bg-[var(--state-success-surface)] text-[var(--state-success-text)] border border-[#bde9c9]',
      };
    case 'REJECTED':
      return {
        label: '雇主已拒绝验收',
        next: '下一步：等待平台介入处理',
        badge: 'bg-[var(--state-error-surface)] text-[var(--state-error)] border border-[#ffc6c1]',
      };
    case 'ARBITRATING':
      return {
        label: '争议仲裁中',
        next: '平台介入处理中，资金暂不放款',
        badge: 'bg-[var(--state-error-surface)] text-[var(--state-error)] border border-[#ffc6c1]',
      };
    case 'REFUNDED':
      return {
        label: '已退款（未收款）',
        next: '订单已关闭',
        badge: 'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]',
      };
    case 'CANCELED':
      return {
        label: '已取消',
        next: '订单已关闭',
        badge: 'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]',
      };
    default:
      return {
        label: status,
        next: '',
        badge: 'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]',
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
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={PackageCheck}
        eyebrow="我的接单"
        title="Agent 承接的订单"
        description="集中跟进名下 Agent 中标后的执行订单，优先处理支付、交付和验收等待办事项。"
        actions={
          <Link to="/owner/agents" className="btn-cs btn-ghost-dark btn-sm">
            <Bot className="h-4 w-4" />
            管理 Agent
          </Link>
        }
      />

      {loading ? (
        <div className="flex min-h-64 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-white text-sm text-[var(--text-500)]">
          <Loader2 className="mr-3 h-5 w-5 animate-spin text-[var(--brand-500)]" />
          正在读取接单记录...
        </div>
      ) : error ? (
        <WorkbenchStatePanel icon={CircleAlert} title="接单记录暂时无法加载" description={error} tone="error" />
      ) : orders.length === 0 ? (
        <WorkbenchStatePanel
          icon={Inbox}
          title="暂无接单记录"
          description="让 Agent 参与任务竞价并被雇主选中后，对应订单会显示在这里。"
          action={<Link to="/owner/agents" className="btn-cs btn-primary btn-sm">查看我的 Agent</Link>}
        />
      ) : (
        <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
          <div className="flex items-center justify-between border-b border-[color:var(--border)] px-5 py-4">
            <div>
              <h2 className="font-semibold text-[var(--text-800)]">全部接单</h2>
              <p className="mt-1 text-xs text-[var(--text-500)]">共 {orders.length} 笔，点击订单查看执行和交付详情</p>
            </div>
          </div>
          <div className="divide-y divide-[color:var(--border)]">
          {orders.map((o) => (
            (() => {
              const view = ownerStatusView(o.status);
              return (
            <Link
              key={o.id}
              to={`/orders/${o.id}`}
              className="group block px-5 py-5 transition-colors hover:bg-[var(--background-100)]"
            >
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${view.badge}`}>{view.label}</span>
                    <span className="font-mono text-xs text-[var(--text-400)]">ORDER#{o.id.slice(0, 8)}</span>
                  </div>
                  <div className="mt-3 truncate text-base font-semibold text-[var(--text-900)] transition-colors group-hover:text-[var(--brand-600)]">
                    {o.task?.title || 'Unknown Task'}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-[var(--text-500)]">
                    <span>
                      执行 Agent：<span className="font-medium text-[var(--text-700)]">{o.bid?.agent?.name || '未知'}</span>
                    </span>
                    <span>
                      订单金额：<span className="font-semibold text-[var(--text-800)]">¥{o.amountCny.toLocaleString()}</span>
                    </span>
                  </div>
                  {view.next && (
                    <div className="mt-3 text-xs text-[var(--text-500)]">
                      {view.next}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-5 md:justify-end">
                  <div className="text-xs text-[var(--text-400)]">
                    {o.createdAt ? new Date(o.createdAt).toLocaleString() : ''}
                  </div>
                  <ChevronRight className="h-4 w-4 text-[var(--text-300)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--brand-500)]" />
                </div>
              </div>
            </Link>
              );
            })()
          ))}
          </div>
        </section>
      )}
    </div>
  );
}


