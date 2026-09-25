import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  FileEdit,
  Gavel,
  Loader2,
  Package,
  RefreshCw,
  Store,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  employerConfirmSpecChange,
  employerPayWithBalance,
  employerRaiseDispute,
  employerRequestCancel,
  employerRequestSpecChange,
  employerReviewDelivery,
  employerSpecAction,
  getEmployerOrderDetail,
} from '../api/longtaskApi';
import type {
  EmployerOrderCancelRequest,
  EmployerOrderDelivery,
  EmployerOrderDetail,
  EmployerOrderDispute,
  EmployerOrderSpecChange,
} from '../api/longtaskApi';
import { WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';
import EmployerOrderChat from '../components/longtask/EmployerOrderChat';
import { Skeleton } from '../components/ui/Skeleton';
import { useConfirm } from '../components/ui/confirm-context';
import { useAuthStore } from '../store/authStore';

const CONTRACT_LABEL: Record<string, string> = {
  signing: '签约中',
  awaiting_confirmation: '待确认方案',
  signed: '已签约',
  cancelled: '已取消',
};

const DELIVERY_LABEL: Record<string, string> = {
  submitted: '待验收',
  in_accept: '待验收',
  accepted: '已验收',
  auto_accepted: '自动验收',
  revision_requested: '已要求修订',
  rejected: '已驳回',
  revising: '修订中',
};

const CANCEL_LABEL: Record<string, string> = {
  open: '协商中（等待对方响应）',
  accepted: '对方已同意取消',
  rejected: '对方拒绝取消',
  counter_proposed: '对方提出反提案',
  finalized: '取消结算已完成',
  to_dispute: '已转纠纷',
};

const DISPUTE_LABEL: Record<string, string> = {
  evidence_open: '举证期（3 天）',
  arbitrating: '平台仲裁中',
  resolved: '已裁定（待确认）',
  acknowledged: '仲裁已终态',
};

const CHANGE_STATUS_LABEL: Record<string, string> = {
  requested: '待判定（Console 24h）',
  classified: '已判定',
  proposed: '提案待响应',
  confirmed: '已确认',
  rejected: '已拒绝',
};

function changeClassificationLabel(change: EmployerOrderSpecChange): string {
  if (change.classification === 'new_requirement') return '新增需求';
  if (change.classification === 'revision') return '修订';
  return '待判定';
}

/** 兼容两层 payload 包装：服务端存 { payload: { description } } */
function changeDescription(change: EmployerOrderSpecChange): string {
  const p = change.payload as {
    payload?: { description?: unknown };
    description?: unknown;
  } | null;
  const d = p?.payload?.description ?? p?.description;
  return typeof d === 'string' ? d.trim() : '';
}

/** 里程碑权重：Console 可能传分数（合计 1）或百分数 */
function formatWeight(weight?: number): string {
  if (typeof weight !== 'number') return '—';
  return weight <= 1 ? `${Math.round(weight * 100)}%` : `${weight}%`;
}

/**
 * 雇主订单详情（长任务线签约→交付→验收）：
 * Spec 确认/驳回、验收/要求修订、取消协商、纠纷入口。
 */
export default function EmployerOrderDetail() {
  const { id } = useParams();
  const { token } = useAuthStore();
  const confirm = useConfirm();
  const [detail, setDetail] = useState<EmployerOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [changeDesc, setChangeDesc] = useState('');

  const load = useCallback(async () => {
    if (!id || !token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setDetail(await getEmployerOrderDetail(token, id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取订单详情失败');
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 统一执行雇主动作：成功后回读详情刷新状态 */
  async function runAction(action: () => Promise<unknown>, successText: string) {
    setBusy(true);
    setMsg('');
    try {
      await action();
      setMsgOk(true);
      setMsg(successText);
      await load();
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : '操作失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <WorkbenchStatePanel
        icon={Gavel}
        title="登录后查看订单"
        description="签约、方案确认与验收只能由订单雇主本人操作。"
      />
    );
  }

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="正在读取订单详情">
        <Skeleton className="h-8 w-56" rounded="sm" />
        <Skeleton className="h-28 w-full" rounded="lg" />
        <Skeleton className="h-40 w-full" rounded="lg" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <WorkbenchStatePanel
        icon={Gavel}
        title="无法查看订单"
        description={error || '订单不存在，或你不是该订单的雇主'}
        action={
          <Link
            to="/longtask/employer/orders"
            className="text-sm font-medium text-[var(--brand-600)] hover:underline"
          >
            返回我的签约订单
          </Link>
        }
        tone="error"
      />
    );
  }

  const { order, task, workspace, deliveries, latestCancelRequest, latestDispute } =
    detail;
  const specChanges = detail.specChanges ?? [];
  const pendingConfirmChange =
    specChanges.find(
      (c) => c.classification === 'new_requirement' && c.status === 'classified',
    ) ?? null;
  const nextChangeSeq =
    specChanges.reduce((max, c) => Math.max(max, c.changeSeq), 0) + 1;
  const pendingDelivery = deliveries.find((d) => d.status === 'submitted') ?? null;
  const canConfirmSpec = order.contractStatus === 'awaiting_confirmation';
  const canReview = order.deliveryStatus === 'in_accept' && !!pendingDelivery;
  const canRequestChange =
    order.contractStatus === 'signed' && order.settlementStatus !== 'settled';
  const canCancel =
    order.contractStatus === 'signed' &&
    order.settlementStatus !== 'settled' &&
    (!latestCancelRequest || latestCancelRequest.status === 'rejected');
  const canDispute =
    order.deliveryStatus === 'accepted' &&
    (!latestDispute || latestDispute.status === 'acknowledged');

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/longtask/employer/orders"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-500)] hover:text-[var(--brand-600)]"
        >
          <ArrowLeft className="h-4 w-4" />
          返回我的签约订单
        </Link>
      </div>

      <header className="rounded-2xl border border-[color:var(--border)] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--text-900)]">
              {task?.title ?? '未知任务'}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--text-600)]">
              <span className="inline-flex items-center gap-1.5">
                <Store className="h-4 w-4 text-[var(--text-400)]" />
                {workspace?.name ?? '未知工作室'}
              </span>
              {order.finalPriceCny != null && (
                <span className="font-semibold text-[var(--brand-600)]">
                  ¥{order.finalPriceCny}
                </span>
              )}
              <span>方案版本 v{order.specVersion}</span>
              {order.specRejectionCount > 0 && (
                <span>已驳回 {order.specRejectionCount} 次</span>
              )}
            </div>
            <p className="mt-1 break-all text-xs text-[var(--text-400)]">
              订单 {order.id}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[var(--background-100)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-600)]">
              {CONTRACT_LABEL[order.contractStatus] ?? order.contractStatus}
            </span>
            {order.deliveryStatus && (
              <span className="rounded-full bg-[var(--background-100)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-600)]">
                {DELIVERY_LABEL[order.deliveryStatus] ?? order.deliveryStatus}
              </span>
            )}
            {order.settlementStatus && (
              <span className="rounded-full bg-[var(--background-100)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-600)]">
                {order.settlementStatus === 'settled' ? '已结算' : '结算中'}
              </span>
            )}
          </div>
        </div>
      </header>

      {msg && (
        <div
          className={`flex items-center gap-2 rounded-xl border border-[color:var(--border)] px-4 py-3 text-sm ${
            msgOk
              ? 'bg-[var(--background-100)] text-[var(--state-success-text)]'
              : 'bg-[var(--background-100)] text-[var(--state-error)]'
          }`}
        >
          {msgOk ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <CircleAlert className="h-4 w-4 shrink-0" />
          )}
          {msg}
        </div>
      )}

      {/* 签约托管支付（金额语义统一为元） */}
      {order.contractStatus === 'signing' && (
        <section className="rounded-2xl border border-[color:var(--border)] bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold text-[var(--text-800)]">
              <Wallet className="h-5 w-5 text-[var(--brand-600)]" />
              签约托管支付
            </h2>
            {order.paymentStatus === 'paid' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--state-success-surface)] px-2.5 py-0.5 text-xs font-medium text-[var(--state-success-text)]">
                <CheckCircle2 className="h-3 w-3" />
                已托管
              </span>
            ) : (
              <span className="rounded-full bg-[var(--state-warning-surface)] px-2.5 py-0.5 text-xs font-medium text-[var(--state-warning)]">
                待支付
              </span>
            )}
          </div>

          {order.paymentStatus === 'paid' ? (
            <p className="mt-3 text-sm text-[var(--text-600)]">
              已支付 ¥{order.finalPriceCny ?? '—'} 入平台托管
              {order.paidAt ? `（${new Date(order.paidAt).toLocaleString()}）` : ''}
              ，等待工作室侧创建项目并推送交付方案。
            </p>
          ) : (
            <>
              <p className="mt-3 text-sm text-[var(--text-500)]">
                支付订单金额到平台托管后，工作室侧将开始执行并推送交付方案；资金在验收通过后才会结算给工作室。
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="text-2xl font-bold text-[var(--text-900)]">
                  ¥{order.finalPriceCny ?? '—'}
                </span>
                <button
                  type="button"
                  disabled={busy || order.finalPriceCny == null}
                  onClick={async () => {
                    const { confirmed } = await confirm({
                      title: '余额支付托管',
                      description: `确认用余额支付 ¥${order.finalPriceCny} 到平台托管吗？`,
                      confirmText: '确认支付',
                    });
                    if (!confirmed) return;
                    void runAction(
                      () => employerPayWithBalance(token, order.id),
                      '托管支付成功，等待工作室侧推送交付方案。',
                    );
                  }}
                  className="btn-cs btn-primary min-h-11 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  余额支付托管
                </button>
                <Link
                  to="/finance/recharge"
                  className="text-sm font-medium text-[var(--brand-600)] hover:underline"
                >
                  余额不足？去充值
                </Link>
              </div>
            </>
          )}
        </section>
      )}

      {/* Spec 快照与里程碑（场景四 #11/#12） */}
      <section className="rounded-2xl border border-[color:var(--border)] bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-[var(--text-800)]">交付方案与里程碑</h2>
          {order.specDeadline && canConfirmSpec && (
            <span className="text-xs text-[var(--text-500)]">
              确认截止 {new Date(order.specDeadline).toLocaleString()}
            </span>
          )}
        </div>

        {order.specVersion === 0 ? (
          <p className="mt-3 text-sm text-[var(--text-500)]">
            等待工作室推送交付方案（提交后开启 7 天确认计时）。
          </p>
        ) : (
          <>
            <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-[var(--background-100)] p-3 text-xs leading-5 text-[var(--text-700)]">
              {JSON.stringify(order.specSnapshot?.content ?? null, null, 2)}
            </pre>
            {order.specHash && (
              <p className="mt-2 break-all text-xs text-[var(--text-400)]">
                方案指纹: {order.specHash}
              </p>
            )}
            {order.milestones && order.milestones.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {order.milestones.map((m, index) => (
                  <li
                    key={m.key ?? m.name ?? index}
                    className="flex items-center justify-between rounded-lg bg-[var(--background-100)] px-3 py-2 text-sm"
                  >
                    <span className="text-[var(--text-700)]">
                      {m.name ?? m.key ?? `里程碑 ${index + 1}`}
                    </span>
                    <span className="text-[var(--text-500)]">
                      权重 {formatWeight(m.weight)}
                      {m.status ? ` · ${m.status}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {canConfirmSpec && (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-[var(--text-600)]">
                驳回原因（驳回时填写）
              </span>
              <input
                type="text"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="例如：里程碑验收标准不明确"
                className="h-11 w-full rounded-xl border border-[color:var(--border)] bg-white px-3 text-sm text-[var(--text-800)] outline-none focus:border-[var(--brand-500)]"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  runAction(
                    () => employerSpecAction(token, order.id, 'confirmed'),
                    '已确认方案，订单进入执行阶段。',
                  )
                }
                className="btn-cs btn-primary min-h-11 disabled:cursor-not-allowed disabled:opacity-60"
              >
                确认方案
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  runAction(
                    () =>
                      employerSpecAction(
                        token,
                        order.id,
                        'rejected',
                        rejectReason.trim() || null,
                      ),
                    '已驳回方案，等待对方修订。',
                  )
                }
                className="btn-cs min-h-11 disabled:cursor-not-allowed disabled:opacity-60"
              >
                驳回方案
              </button>
              {busy && <Loader2 className="h-4 w-4 animate-spin text-[var(--text-400)]" />}
            </div>
            <p className="text-xs text-[var(--text-400)]">
              驳回 5 次将自动触发协商取消；7 天内未确认将按超时处理。
            </p>
          </div>
        )}

        {order.contractStatus === 'signed' && (
          <p className="mt-3 flex items-center gap-2 text-sm text-[var(--state-success-text)]">
            <CheckCircle2 className="h-4 w-4" />
            已签约，等待交付。
          </p>
        )}
      </section>

      {/* Spec 变更（场景七 #18 发起 / #20 新增需求二次确认） */}
      <section className="rounded-2xl border border-[color:var(--border)] bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold text-[var(--text-800)]">
            <FileEdit className="h-5 w-5 text-[var(--brand-600)]" />
            方案变更记录
          </h2>
          {specChanges.length > 0 && (
            <span className="rounded-full bg-[var(--background-100)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-600)]">
              {specChanges.length} 条记录 · 当前 v{order.specVersion}
            </span>
          )}
        </div>

        {specChanges.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--text-500)]">暂无变更记录。</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {specChanges.map((change) => (
              <SpecChangeCard
                key={change.id}
                change={change}
                busy={busy}
                needConfirm={pendingConfirmChange?.id === change.id}
                onConfirm={(decision) =>
                  runAction(
                    () =>
                      employerConfirmSpecChange(
                        token,
                        order.id,
                        change.id,
                        decision,
                      ),
                    decision === 'confirmed'
                      ? '已确认新增需求，等待对方推送新版方案。'
                      : '已拒绝该新增需求，原方案继续执行。',
                  )
                }
              />
            ))}
          </ul>
        )}

        {canRequestChange && (
          <div className="mt-4 space-y-3 border-t border-[color:var(--border)] pt-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-[var(--text-600)]">
                发起变更 / 修订请求
              </span>
              <input
                type="text"
                value={changeDesc}
                onChange={(event) => setChangeDesc(event.target.value)}
                placeholder="例如：增加数据导出为 Excel 的能力"
                className="h-11 w-full rounded-xl border border-[color:var(--border)] bg-white px-3 text-sm text-[var(--text-800)] outline-none focus:border-[var(--brand-500)]"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy || !changeDesc.trim()}
                onClick={() => {
                  void runAction(
                    () =>
                      employerRequestSpecChange(
                        token,
                        order.id,
                        nextChangeSeq,
                        changeDesc.trim(),
                      ),
                    '已发起变更请求，对方将在 24 小时内判定为修订或新增需求。',
                  );
                  setChangeDesc('');
                }}
                className="btn-cs btn-primary min-h-11 disabled:cursor-not-allowed disabled:opacity-60"
              >
                发起变更请求（#{nextChangeSeq}）
              </button>
              {busy && <Loader2 className="h-4 w-4 animate-spin text-[var(--text-400)]" />}
            </div>
            <p className="text-xs text-[var(--text-400)]">
              Console 将在 24 小时内判定为「修订」或「新增需求」；判定为新增需求时需你二次确认。
            </p>
          </div>
        )}
      </section>

      {/* 沟通（场景四 #9/#10：Console 推来的 @employer 提问 + 雇主回复 / 主动发起） */}
      <EmployerOrderChat orderId={order.id} token={token} />

      {/* 支付/交付物与验收（场景五 #13/#14） */}
      <section className="rounded-2xl border border-[color:var(--border)] bg-white p-5">
        <h2 className="font-semibold text-[var(--text-800)]">交付物与验收</h2>
        {deliveries.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--text-500)]">暂无交付物提交。</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {deliveries.map((delivery) => (
              <DeliveryCard key={delivery.id} delivery={delivery} />
            ))}
          </ul>
        )}

        {canReview && (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-[var(--text-600)]">
                修订/驳回说明（可选）
              </span>
              <input
                type="text"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="例如：第 3 项验收标准未达标"
                className="h-11 w-full rounded-xl border border-[color:var(--border)] bg-white px-3 text-sm text-[var(--text-800)] outline-none focus:border-[var(--brand-500)]"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  runAction(
                    () => employerReviewDelivery(token, order.id, 'accepted'),
                    '已验收通过，进入售后申诉期与结算流程。',
                  )
                }
                className="btn-cs btn-primary min-h-11 disabled:cursor-not-allowed disabled:opacity-60"
              >
                验收通过
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  runAction(
                    () =>
                      employerReviewDelivery(
                        token,
                        order.id,
                        'revision_requested',
                        rejectReason.trim() || null,
                      ),
                    '已要求修订，等待对方重新交付。',
                  )
                }
                className="btn-cs min-h-11 disabled:cursor-not-allowed disabled:opacity-60"
              >
                要求修订
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  runAction(
                    () =>
                      employerReviewDelivery(
                        token,
                        order.id,
                        'rejected',
                        rejectReason.trim() || null,
                      ),
                    '已驳回本次交付。',
                  )
                }
                className="btn-cs min-h-11 disabled:cursor-not-allowed disabled:opacity-60"
              >
                驳回交付
              </button>
            </div>
            <p className="text-xs text-[var(--text-400)]">
              14 天未验收将自动验收；修订次数超限会进入 2 天修订协商窗口。
            </p>
          </div>
        )}

        {order.deliveryStatus === 'accepted' && (
          <p className="mt-3 text-sm text-[var(--text-500)]">
            已验收
            {order.afterSaleDeadline
              ? `，售后申诉期截止 ${new Date(order.afterSaleDeadline).toLocaleString()}`
              : ''}
            。
          </p>
        )}
      </section>

      {/* 取消协商（场景八 #24）与纠纷（场景十 #33/#39） */}
      <section className="rounded-2xl border border-[color:var(--border)] bg-white p-5">
        <h2 className="font-semibold text-[var(--text-800)]">取消协商与纠纷</h2>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-[var(--background-100)] p-4">
            <div className="text-sm font-semibold text-[var(--text-700)]">协商取消</div>
            {latestCancelRequest ? (
              <CancelSummary request={latestCancelRequest} />
            ) : (
              <p className="mt-1.5 text-sm text-[var(--text-500)]">暂无取消协商记录。</p>
            )}
            {canCancel && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const { confirmed } = await confirm({
                    title: '发起协商取消',
                    description: '发起协商取消后将通知对方在 3 天内响应，确定发起吗？',
                    tone: 'danger',
                    confirmText: '确认发起',
                  });
                  if (!confirmed) return;
                  void runAction(
                    () => employerRequestCancel(token, order.id),
                    '已发起协商取消，等待对方响应。',
                  );
                }}
                className="btn-cs mt-3 min-h-10 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {latestCancelRequest ? '再次发起协商取消' : '发起协商取消'}
              </button>
            )}
          </div>

          <div className="rounded-xl bg-[var(--background-100)] p-4">
            <div className="text-sm font-semibold text-[var(--text-700)]">纠纷仲裁</div>
            {latestDispute ? (
              <DisputeSummary dispute={latestDispute} />
            ) : (
              <p className="mt-1.5 text-sm text-[var(--text-500)]">暂无纠纷记录。</p>
            )}
            {canDispute && (
              <div className="mt-3 space-y-2">
                <input
                  type="text"
                  value={disputeReason}
                  onChange={(event) => setDisputeReason(event.target.value)}
                  placeholder="纠纷原因（可选）"
                  className="h-10 w-full rounded-lg border border-[color:var(--border)] bg-white px-3 text-sm text-[var(--text-800)] outline-none focus:border-[var(--brand-500)]"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const { confirmed } = await confirm({
                      title: '发起纠纷',
                      description: '发起纠纷后进入 3 天举证窗口，平台将介入仲裁，确定发起吗？',
                      tone: 'danger',
                      confirmText: '确认发起',
                    });
                    if (!confirmed) return;
                    void runAction(
                      () =>
                        employerRaiseDispute(
                          token,
                          order.id,
                          disputeReason.trim() || null,
                        ),
                      '已发起纠纷，进入 3 天举证窗口。',
                    );
                  }}
                  className="btn-cs min-h-10 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  发起纠纷
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="btn-cs min-h-10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className="h-4 w-4" />
          刷新状态
        </button>
        {task && (
          <Link
            to={`/longtask/tasks/${task.id}/seats`}
            className="inline-flex items-center gap-1 text-sm text-[var(--text-600)] hover:text-[var(--brand-600)]"
          >
            <Gavel className="h-4 w-4" />
            查看竞标席位
          </Link>
        )}
      </div>
    </div>
  );
}

function DeliveryCard({ delivery }: { delivery: EmployerOrderDelivery }) {
  const ok = delivery.status === 'accepted' || delivery.status === 'auto_accepted';
  return (
    <li className="rounded-xl border border-[color:var(--border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 font-medium text-[var(--text-800)]">
          <Package className="h-4 w-4 text-[var(--text-400)]" />
          第 {delivery.submissionSeq} 次提交
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            ok
              ? 'bg-[var(--brand-50)] text-[var(--state-success-text)]'
              : 'bg-[var(--background-100)] text-[var(--text-600)]'
          }`}
        >
          {ok ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : delivery.status === 'rejected' ? (
            <XCircle className="h-3 w-3" />
          ) : null}
          {DELIVERY_LABEL[delivery.status] ?? delivery.status}
        </span>
      </div>
      {delivery.submittedAt && (
        <p className="mt-1 text-xs text-[var(--text-500)]">
          提交时间 {new Date(delivery.submittedAt).toLocaleString()}
          {delivery.acceptDeadline
            ? ` · 验收截止 ${new Date(delivery.acceptDeadline).toLocaleString()}`
            : ''}
        </p>
      )}
      {delivery.metadata && (
        <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-[var(--background-100)] p-2.5 text-xs leading-5 text-[var(--text-700)]">
          {JSON.stringify(delivery.metadata, null, 2)}
        </pre>
      )}
      {delivery.artifactUrls && delivery.artifactUrls.length > 0 && (
        <ul className="mt-2 space-y-1">
          {delivery.artifactUrls.map((url) => (
            <li key={url}>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="break-all text-xs text-[var(--brand-600)] hover:underline"
              >
                {url}
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function CancelSummary({ request }: { request: EmployerOrderCancelRequest }) {
  return (
    <p className="mt-1.5 text-sm text-[var(--text-600)]">
      {CANCEL_LABEL[request.status] ?? request.status}
      <span className="ml-2 text-xs text-[var(--text-400)]">
        第 {request.cancelProposalSeq} 次
        {request.trigger ? ` · 触发源 ${request.trigger}` : ''}
      </span>
    </p>
  );
}

function DisputeSummary({ dispute }: { dispute: EmployerOrderDispute }) {
  return (
    <p className="mt-1.5 text-sm text-[var(--text-600)]">
      {DISPUTE_LABEL[dispute.status] ?? dispute.status}
      {dispute.resolution && (
        <span className="ml-2 text-xs text-[var(--text-400)]">
          裁定 {dispute.resolution}
          {dispute.resolutionAmountCny != null
            ? ` · ¥${dispute.resolutionAmountCny}`
            : ''}
        </span>
      )}
    </p>
  );
}

/**
 * Spec 变更记录卡片（场景七）：
 * 展示判定结果与状态；判定为「新增需求」且待雇主确认时提供二次确认/拒绝按钮（#20）。
 */
function SpecChangeCard({
  change,
  busy,
  needConfirm,
  onConfirm,
}: {
  change: EmployerOrderSpecChange;
  busy: boolean;
  needConfirm: boolean;
  onConfirm: (decision: 'confirmed' | 'rejected') => void;
}) {
  const done = change.status === 'confirmed' || change.status === 'rejected';
  const desc = changeDescription(change);
  return (
    <li
      className={`rounded-xl border p-4 ${
        needConfirm
          ? 'border-[var(--brand-300)] bg-[var(--brand-50)]'
          : 'border-[color:var(--border)]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 font-medium text-[var(--text-800)]">
          <FileEdit className="h-4 w-4 text-[var(--text-400)]" />
          变更 #{change.changeSeq}
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              change.classification === 'new_requirement'
                ? 'bg-[var(--state-warning-surface)] text-[var(--state-warning)]'
                : 'bg-[var(--background-100)] text-[var(--text-600)]'
            }`}
          >
            {changeClassificationLabel(change)}
          </span>
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            done
              ? 'bg-[var(--brand-50)] text-[var(--state-success-text)]'
              : 'bg-[var(--background-100)] text-[var(--text-600)]'
          }`}
        >
          {done ? <CheckCircle2 className="h-3 w-3" /> : null}
          {CHANGE_STATUS_LABEL[change.status] ?? change.status}
        </span>
      </div>
      {desc && (
        <p className="mt-1.5 text-sm text-[var(--text-700)]">{desc}</p>
      )}
      <p className="mt-1 text-xs text-[var(--text-400)]">
        发起时间 {new Date(change.createdAt).toLocaleString()}
      </p>

      {needConfirm && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm('confirmed')}
            className="btn-cs btn-primary min-h-10 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            确认新增需求
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm('rejected')}
            className="btn-cs min-h-10 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            拒绝（维持原方案）
          </button>
          {busy && <Loader2 className="h-4 w-4 animate-spin text-[var(--text-400)]" />}
        </div>
      )}
    </li>
  );
}
