import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  CircleAlert,
  Clock,
  Inbox,
  Loader2,
  PackageCheck,
  RefreshCw,
  Store,
  Upload,
  Wallet,
} from 'lucide-react';
import {
  getOwnerLongtaskOrderDetail,
  listOwnerLongtaskOrders,
  ownerSubmitDeliverable,
} from '../api/longtaskApi';
import type {
  OwnerLongtaskOrder,
  OwnerLongtaskOrderDetail,
} from '../api/longtaskApi';
import { WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';
import { useAuthStore } from '../store/authStore';

/**
 * Owner 订单执行阶段（PRD §6 长任务资金流，卖方视角）：
 * 签约中（等雇主托管支付）→ 待执行（已托管等 Spec/确认）→ 执行中（已签约待交付）
 * → 待验收（已提交交付）→ 修订中 → 已验收待结算 → 已结算。
 */
function stageView(order: OwnerLongtaskOrder): {
  label: string;
  cls: string;
  hint: string;
  canDeliver: boolean;
} {
  if (order.contractStatus === 'signing') {
    return order.paymentStatus === 'paid'
      ? {
          label: '雇主已托管',
          cls: 'bg-[var(--brand-50)] text-[var(--brand-700)] border border-[var(--brand-200)]',
          hint: '资金已入平台托管，等待雇主侧/Console 推送 Spec 并确认后开始执行。',
          canDeliver: false,
        }
      : {
          label: '等待雇主支付',
          cls: 'bg-[var(--state-warning-surface)] text-[var(--state-warning)] border border-[#f3d79a]',
          hint: '雇主尚未托管支付订单金额，支付后即可安排执行。',
          canDeliver: false,
        };
  }
  if (order.contractStatus === 'awaiting_confirmation') {
    return {
      label: 'Spec 确认中',
      cls: 'bg-[var(--brand-50)] text-[var(--brand-700)] border border-[var(--brand-200)]',
      hint: 'Spec 已推送，等待雇主确认（7 天内未确认将按超时处理）。',
      canDeliver: false,
    };
  }
  if (order.contractStatus === 'signed') {
    if (order.deliveryStatus === 'in_accept') {
      return {
        label: '待雇主验收',
        cls: 'bg-[var(--state-success-surface)] text-[var(--state-success-text)] border border-[#bde9c9]',
        hint: '交付物已提交，雇主有 14 天验收窗口（超时自动验收）。',
        canDeliver: false,
      };
    }
    if (order.deliveryStatus === 'revising') {
      return {
        label: '修订中',
        cls: 'bg-[var(--state-warning-surface)] text-[var(--state-warning)] border border-[#f3d79a]',
        hint: '雇主已要求修订，修订完成后重新提交交付物。',
        canDeliver: true,
      };
    }
    return {
      label: '执行中',
      cls: 'bg-[var(--brand-50)] text-[var(--brand-700)] border border-[var(--brand-200)]',
      hint: '合同已生效，请按里程碑执行并提交交付物。',
      canDeliver: true,
    };
  }
  if (order.contractStatus === 'cancelled') {
    return {
      label: '已取消',
      cls: 'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]',
      hint: '订单已取消（协商取消或超时）。',
      canDeliver: false,
    };
  }
  return {
    label: order.contractStatus,
    cls: 'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]',
    hint: '',
    canDeliver: false,
  };
}

/** Agent Owner「接单履约」页：名下工作室的中标订单与任务执行流程 */
export default function OwnerLongtaskOrders() {
  const { token, user } = useAuthStore();
  const [orders, setOrders] = useState<OwnerLongtaskOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  // 展开的详情（交付历史）与提交表单
  const [detail, setDetail] = useState<Record<string, OwnerLongtaskOrderDetail>>({});
  const [showForm, setShowForm] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('');
  const [urls, setUrls] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await listOwnerLongtaskOrders(token);
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取接单失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(orderId: string) {
    if (!token) return;
    try {
      const d = await getOwnerLongtaskOrderDetail(token, orderId);
      setDetail((prev) => ({ ...prev, [orderId]: d }));
    } catch {
      /* 详情加载失败不阻塞 */
    }
  }

  async function submitDeliverable(orderId: string) {
    if (!token) return;
    const artifactUrls = urls
      .split('\n')
      .map((u) => u.trim())
      .filter(Boolean);
    setBusyId(orderId);
    setMsg(null);
    try {
      await ownerSubmitDeliverable(token, orderId, {
        note: note.trim() || null,
        artifactUrls: artifactUrls.length > 0 ? artifactUrls : null,
      });
      setMsg({ id: orderId, ok: true, text: '交付物已提交，等待雇主验收（14 天窗口）。' });
      setShowForm((prev) => ({ ...prev, [orderId]: false }));
      setNote('');
      setUrls('');
      await load();
      await openDetail(orderId);
    } catch (err) {
      setMsg({
        id: orderId,
        ok: false,
        text: err instanceof Error ? err.message : '提交失败，请稍后重试',
      });
    } finally {
      setBusyId(null);
    }
  }

  if (!user?.id || !token) {
    return (
      <WorkbenchStatePanel
        icon={PackageCheck}
        title="登录后查看接单履约"
        description="你的工作室中标长任务后，执行流程（托管/交付/验收/结算）都在这里跟进。"
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <header className="flex flex-col gap-3 border-b border-[color:var(--border)] pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)] text-[var(--brand-600)]">
            <PackageCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text-900)]">
              接单履约（长任务）
            </h1>
            <p className="mt-1 text-sm text-[var(--text-500)]">
              名下工作室中标后的执行流程：雇主托管 → 按里程碑交付 → 雇主验收 → 结算到你的余额。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="btn-cs min-h-10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          刷新
        </button>
      </header>

      {error && (
        <div className="rounded-xl border border-[color:var(--border)] bg-[var(--background-100)] px-4 py-3 text-sm text-[var(--state-error)]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3" aria-label="正在读取接单">
          <div className="h-28 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
          <div className="h-28 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
        </div>
      ) : orders.length === 0 ? (
        <WorkbenchStatePanel
          icon={Inbox}
          title="暂无中标订单"
          description="参与任务大厅竞标并被雇主选中后，订单会出现在这里。"
          action={
            <Link
              to="/longtask/workspaces"
              className="text-sm font-medium text-[var(--brand-600)] hover:underline"
            >
              去任务大厅看商机
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => {
            const stage = stageView(order);
            const d = detail[order.id];
            return (
              <li
                key={order.id}
                className="rounded-2xl border border-[color:var(--border)] bg-white p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-[var(--text-900)]">
                      {order.taskTitle ?? '未命名任务'}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-500)]">
                      <span className="inline-flex items-center gap-1.5">
                        <Store className="h-4 w-4 text-[var(--text-400)]" />
                        {order.workspaceName ?? '我的工作室'}
                      </span>
                      <span className="text-sm font-semibold text-[var(--brand-600)]">
                        ¥{order.finalPriceCny ?? '—'}
                      </span>
                      <span>接单于 {new Date(order.createdAt).toLocaleString()}</span>
                      {order.paymentStatus === 'paid' && (
                        <span className="inline-flex items-center gap-1 text-[var(--state-success-text)]">
                          <Wallet className="h-3.5 w-3.5" />
                          雇主已托管
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`px-2.5 py-0.5 text-xs font-medium rounded border ${stage.cls}`}>
                    {stage.label}
                  </span>
                </div>

                {stage.hint && (
                  <p className="mt-2 text-xs text-[var(--text-500)]">{stage.hint}</p>
                )}

                {order.settlementStatus === 'settled' && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-[var(--state-success-text)]">
                    <CheckCircle2 className="h-4 w-4" />
                    已结算 ¥{order.settlementAmountCny ?? order.finalPriceCny} 到你的余额
                  </p>
                )}

                {msg?.id === order.id && (
                  <div
                    className={`mt-3 flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[var(--background-100)] px-3 py-2 text-sm ${
                      msg.ok ? 'text-[var(--state-success-text)]' : 'text-[var(--state-error)]'
                    }`}
                  >
                    {msg.ok ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
                    {msg.text}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {stage.canDeliver && !showForm[order.id] && (
                    <button
                      type="button"
                      onClick={() => setShowForm((prev) => ({ ...prev, [order.id]: true }))}
                      className="btn-cs btn-primary btn-sm"
                    >
                      <Upload className="h-4 w-4" />
                      提交交付物
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void openDetail(order.id)}
                    className="inline-flex items-center gap-1 text-sm text-[var(--text-600)] hover:text-[var(--brand-600)]"
                  >
                    {d ? '收起详情' : '查看交付历史'}
                  </button>
                </div>

                {/* 提交交付物表单 */}
                {stage.canDeliver && showForm[order.id] && (
                  <div className="mt-3 space-y-3 rounded-xl bg-[var(--background-100)] p-4">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-[var(--text-600)]">
                        交付说明（可选）
                      </span>
                      <input
                        type="text"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="例如：已完成全部功能并自测通过"
                        className="h-11 w-full rounded-xl border border-[color:var(--border)] bg-white px-3 text-sm text-[var(--text-800)] outline-none focus:border-[var(--brand-500)] focus:ring-4 focus:ring-blue-500/10"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-[var(--text-600)]">
                        交付物链接（每行一个 URL，可选）
                      </span>
                      <textarea
                        rows={2}
                        value={urls}
                        onChange={(event) => setUrls(event.target.value)}
                        placeholder={'https://oss.example.com/result.zip\nhttps://docs.example.com/readme'}
                        className="w-full resize-none rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-800)] outline-none focus:border-[var(--brand-500)] focus:ring-4 focus:ring-blue-500/10"
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={busyId === order.id}
                        onClick={() => void submitDeliverable(order.id)}
                        className="btn-cs btn-primary min-h-10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busyId === order.id ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            提交中…
                          </>
                        ) : (
                          '确认提交'
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowForm((prev) => ({ ...prev, [order.id]: false }))}
                        className="btn-cs min-h-10"
                      >
                        取消
                      </button>
                      <span className="inline-flex items-center gap-1 text-xs text-[var(--text-400)]">
                        <Clock className="h-3.5 w-3.5" />
                        提交后雇主有 14 天验收窗口
                      </span>
                    </div>
                  </div>
                )}

                {/* 交付历史 */}
                {d && (
                  <div className="mt-3 space-y-2">
                    {d.deliveries.length === 0 ? (
                      <p className="text-xs text-[var(--text-500)]">暂无交付记录。</p>
                    ) : (
                      d.deliveries.map((delivery) => (
                        <div
                          key={delivery.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[color:var(--border)] px-3 py-2"
                        >
                          <span className="text-sm text-[var(--text-700)]">
                            第 {delivery.submissionSeq} 次交付
                            {delivery.metadata?.note ? ` · ${String(delivery.metadata.note)}` : ''}
                          </span>
                          <div className="flex items-center gap-3 text-xs text-[var(--text-500)]">
                            <span>{new Date(delivery.createdAt).toLocaleString()}</span>
                            <span
                              className={
                                delivery.status === 'accepted' || delivery.status === 'auto_accepted'
                                  ? 'text-[var(--state-success-text)]'
                                  : delivery.status === 'submitted'
                                    ? 'text-[var(--brand-600)]'
                                    : 'text-[var(--state-warning)]'
                              }
                            >
                              {delivery.status === 'accepted' || delivery.status === 'auto_accepted'
                                ? '已验收'
                                : delivery.status === 'submitted'
                                  ? '待验收'
                                  : delivery.status === 'revision_requested'
                                    ? '已要求修订'
                                    : '已驳回'}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                    {d.settlement && (
                      <p className="text-xs text-[var(--text-500)]">
                        结算单：¥{d.settlement.amount_cny ?? '—'} · {d.settlement.settlement_status}
                        {d.settlement.completed_at
                          ? ` · ${new Date(d.settlement.completed_at).toLocaleString()}`
                          : ''}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
