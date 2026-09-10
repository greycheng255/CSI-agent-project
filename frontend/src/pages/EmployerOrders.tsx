import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  ClipboardList,
  Gavel,
  Inbox,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { listEmployerOrders } from '../api/longtaskApi';
import type { EmployerOrder } from '../api/longtaskApi';
import { WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';
import { useAuthStore } from '../store/authStore';

/** 订单状态投影为用户可读文案（PRD §6 签约→交付→验收） */
const CONTRACT_LABEL: Record<string, string> = {
  signing: '签约中',
  awaiting_confirmation: '待确认 Spec',
  signed: '已签约',
  cancelled: '已取消',
};

const DELIVERY_LABEL: Record<string, string> = {
  in_accept: '待验收',
  accepted: '已验收',
  revising: '修订中',
};

const SETTLEMENT_LABEL: Record<string, string> = {
  pending: '结算中',
  settled: '已结算',
};

/**
 * 雇主「我的签约订单」列表（长任务线）。
 * 卖方的交付/验收与买方确认 Spec、取消协商、纠纷都在订单详情页完成。
 */
export default function EmployerOrders() {
  const { token, user } = useAuthStore();
  const [orders, setOrders] = useState<EmployerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await listEmployerOrders(token);
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取订单失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user?.id || !token) {
    return (
      <div className="space-y-6">
        <WorkbenchStatePanel
          icon={ClipboardList}
          title="登录后查看我的签约订单"
          description="长任务中标后生成的订单（Spec 确认、交付验收、取消协商与纠纷）都在这里处理。"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 border-b border-[color:var(--border)] pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)] text-[var(--brand-600)]">
            <ClipboardList className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text-900)]">
              我的签约订单
            </h1>
            <p className="mt-1 text-sm text-[var(--text-500)]">
              中标后进入签约：确认 Spec → 等待交付 → 验收；异常时可发起取消协商或纠纷。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="btn-cs min-h-10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          刷新
        </button>
      </header>

      {error && (
        <div className="rounded-xl border border-[color:var(--border)] bg-[var(--background-100)] px-4 py-3 text-sm text-[var(--state-error)]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3" aria-label="正在读取订单">
          <div className="h-24 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
          <div className="h-24 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
        </div>
      ) : orders.length === 0 ? (
        <WorkbenchStatePanel
          icon={Inbox}
          title="暂无签约订单"
          description="在任务竞标席位页选定中标工作室后，系统会自动生成签约订单。"
          action={
            <Link
              to="/longtask/workspaces"
              className="text-sm font-medium text-[var(--brand-600)] hover:underline"
            >
              去看工作室画廊
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li
              key={order.id}
              className="rounded-2xl border border-[color:var(--border)] bg-white p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to={`/longtask/employer/orders/${order.id}`}
                    className="font-semibold text-[var(--text-900)] hover:text-[var(--brand-600)]"
                  >
                    {order.taskTitle ?? '未命名任务'}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-500)]">
                    <span>中标工作室：{order.workspaceName ?? '—'}</span>
                    {order.finalPriceCny != null && (
                      <span className="text-sm font-semibold text-[var(--brand-600)]">
                        ¥{order.finalPriceCny}
                      </span>
                    )}
                    <span>下单于 {new Date(order.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip
                    label={CONTRACT_LABEL[order.contractStatus] ?? order.contractStatus}
                    highlight={order.contractStatus === 'awaiting_confirmation'}
                  />
                  {order.contractStatus === 'signing' && (
                    <StatusChip
                      label={order.paymentStatus === 'paid' ? '已托管' : '待支付'}
                      highlight={order.paymentStatus !== 'paid'}
                    />
                  )}
                  {order.deliveryStatus && (
                    <StatusChip
                      label={
                        DELIVERY_LABEL[order.deliveryStatus] ?? order.deliveryStatus
                      }
                      highlight={order.deliveryStatus === 'in_accept'}
                    />
                  )}
                  {order.settlementStatus && (
                    <StatusChip
                      label={
                        SETTLEMENT_LABEL[order.settlementStatus] ??
                        order.settlementStatus
                      }
                    />
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Link
                  to={`/longtask/employer/orders/${order.id}`}
                  className="btn-cs btn-primary btn-sm"
                >
                  查看并处理
                </Link>
                <Link
                  to={`/longtask/tasks/${order.marketplaceTaskId}/seats`}
                  className="inline-flex items-center gap-1 text-sm text-[var(--text-600)] hover:text-[var(--brand-600)]"
                >
                  <Gavel className="h-4 w-4" />
                  查看竞标席位
                </Link>
                {order.contractStatus === 'signed' &&
                  order.deliveryStatus === 'accepted' && (
                    <span className="inline-flex items-center gap-1 text-sm text-[var(--state-success-text)]">
                      <CheckCircle2 className="h-4 w-4" />
                      交付已验收
                    </span>
                  )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusChip({
  label,
  highlight = false,
}: {
  label: string;
  highlight?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        highlight
          ? 'bg-[var(--brand-50)] text-[var(--brand-600)]'
          : 'bg-[var(--background-100)] text-[var(--text-600)]'
      }`}
    >
      {label}
    </span>
  );
}
