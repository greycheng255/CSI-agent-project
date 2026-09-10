import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Gavel, Rocket, Sparkles, Store, CheckCircle2, Loader2 } from 'lucide-react';
import {
  getMarketplaceTask,
  getTaskSeatBids,
  getWorkspaceByOwner,
  ensureDefaultWorkspace,
  submitOwnerMarketplaceBid,
  selectMarketplaceBid,
  rejectAllMarketplaceBids,
} from '../api/longtaskApi';
import type {
  MarketplaceSeatBid,
  MarketplaceTaskInfo,
  WorkspaceShowcaseData,
} from '../api/longtaskApi';
import { WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';
import { useAuthStore } from '../store/authStore';

/** 雇主侧竞标列表排序维度（PRD §5.6.1：默认综合分，支持手动切换） */
const SEAT_SORT_OPTIONS = [
  { value: 'composite', label: '综合排序' },
  { value: 'price_asc', label: '报价从低到高' },
  { value: 'price_desc', label: '报价从高到低' },
  { value: 'latest', label: '提交时间倒序' },
  { value: 'rating', label: '评分从高到低' },
] as const;
type SeatSortKey = (typeof SEAT_SORT_OPTIONS)[number]['value'];

const toNum = (value: number | string | null | undefined): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * 长任务竞标席位页（PRD §5.6.1）：
 * - 雇主：查看当前轮竞标方（名称/头像用提交时席位快照；综合分仅排序不展示）。
 * - Agent Owner：可在此「用我的工作室手动参与竞标」——不等 Console 5min 轮询，
 *   登录态立即占席位（source=manual_assign），后端校验 workspace 归属。
 */
export default function LongTaskSeats() {
  const { id } = useParams();
  const { user, token } = useAuthStore();
  const [task, setTask] = useState<MarketplaceTaskInfo | null>(null);
  const [seats, setSeats] = useState<MarketplaceSeatBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Owner 手动参与竞标状态
  const [myWorkspace, setMyWorkspace] = useState<WorkspaceShowcaseData | null>(null);
  const [wsLoaded, setWsLoaded] = useState(false);
  const [showBidForm, setShowBidForm] = useState(false);
  const [price, setPrice] = useState('');
  const [plan, setPlan] = useState('');
  const [delivery, setDelivery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [bidMsg, setBidMsg] = useState('');
  const [bidOk, setBidOk] = useState(false);
  // 雇主选标/全部驳回
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState('');
  const [actionOk, setActionOk] = useState(false);
  const [sortBy, setSortBy] = useState<SeatSortKey>('composite');

  /** 雇主侧列表按所选维度排序；综合分为服务端默认序（score 降序），切换后本地重排 */
  const sortedSeats = useMemo(() => {
    if (sortBy === 'composite') return seats;
    const copy = [...seats];
    switch (sortBy) {
      case 'price_asc':
        copy.sort((a, b) => a.bid.priceCny - b.bid.priceCny);
        break;
      case 'price_desc':
        copy.sort((a, b) => b.bid.priceCny - a.bid.priceCny);
        break;
      case 'latest':
        copy.sort(
          (a, b) =>
            new Date(b.bid.createdAt).getTime() -
            new Date(a.bid.createdAt).getTime(),
        );
        break;
      case 'rating':
        copy.sort((a, b) => toNum(b.avgRating) - toNum(a.avgRating));
        break;
    }
    return copy;
  }, [seats, sortBy]);

  const loadSeats = useCallback(
    (taskId: string) => {
      getTaskSeatBids(taskId)
        .then((seatBids) => setSeats(Array.isArray(seatBids) ? seatBids : []))
        .catch(() => {
          /* 席位读取失败不阻塞页面主体 */
        });
    },
    [],
  );

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([getMarketplaceTask(id), getTaskSeatBids(id)])
      .then(([taskData, seatBids]) => {
        if (cancelled) return;
        setTask(taskData);
        setSeats(Array.isArray(seatBids) ? seatBids : []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '读取席位信息失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // 当前登录 Owner 名下的工作室（用于手动参与竞标）
  useEffect(() => {
    if (!user?.id) {
      setWsLoaded(true);
      return;
    }
    let cancelled = false;
    getWorkspaceByOwner(user.id)
      .then((ws) => {
        if (!cancelled) setMyWorkspace(ws);
      })
      .catch(() => {
        /* 无工作室不报错，UI 走引导文案 */
      })
      .finally(() => {
        if (!cancelled) setWsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-5" aria-label="正在读取竞标席位">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-[var(--background-100)]" />
        <div className="h-24 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="mx-auto w-full max-w-3xl py-8">
        <WorkbenchStatePanel
          icon={Gavel}
          title="无法查看竞标席位"
          description={error || '任务不存在'}
          tone="error"
        />
      </div>
    );
  }

  const budget =
    task.budgetMinCny != null && task.budgetMaxCny != null
      ? `¥${task.budgetMinCny} - ¥${task.budgetMaxCny}`
      : task.budgetMaxCny != null
        ? `≤ ¥${task.budgetMaxCny}`
        : '预算面议';

  const openForBid = task.status === 'open';
  // 选标/驳回只能由雇主本人执行；无主任务（employerUserId 为空）由首个操作者认领
  const isEmployer = !!user?.id && (!task.employerUserId || task.employerUserId === user.id);
  const unclaimedTask = !task.employerUserId;
  const mineWsId = myWorkspace?.id ?? null;
  const alreadyBid = !!mineWsId && seats.some((s) => s.bid.workspaceId === mineWsId);
  const wsUsable = !!myWorkspace && myWorkspace.displayStatus === 'active';

  const canSubmit =
    !!token &&
    !!user?.id &&
    !!mineWsId &&
    wsUsable &&
    openForBid &&
    !alreadyBid &&
    !submitting;

  // 无工作室场景：一键自动开通默认工作室（PRD §4.1/§4.2），成功后可直接参与竞标
  async function handleProvisionDefault() {
    if (!token) return;
    setProvisioning(true);
    setBidMsg('');
    try {
      const result = await ensureDefaultWorkspace(token, user?.displayName ?? null);
      setMyWorkspace(result.workspace);
      setBidOk(true);
      setBidMsg(
        result.created
          ? `已自动开通「${result.workspace.name}」，可直接参与竞标。`
          : `已找到你的工作室「${result.workspace.name}」。`,
      );
      if (result.workspace.displayStatus === 'active') {
        setShowBidForm(true); // 开通后无缝进入手动参与竞标表单
      }
    } catch (err) {
      setBidOk(false);
      setBidMsg(err instanceof Error ? err.message : '自动开通失败，请稍后重试');
    } finally {
      setProvisioning(false);
    }
  }

  async function handleSubmitBid() {
    if (!id || !token || !mineWsId) return;
    const priceCny = Number(price);
    if (!Number.isInteger(priceCny) || priceCny <= 0) {
      setBidMsg('请填写正整数报价（元）');
      return;
    }
    setSubmitting(true);
    setBidMsg('');
    try {
      const submitted = await submitOwnerMarketplaceBid(token, {
        taskId: id,
        workspaceId: mineWsId,
        priceCny,
        planSummary: plan.trim() ? plan.trim() : null,
        estimatedDeliveryAt: delivery ? delivery : null,
      });
      setBidOk(true);
      setBidMsg(
        submitted.similarity?.warning
          ? `已提交竞标，席位 +1；⚠ 与已有 ${submitted.similarity.similarCount} 个方案相似度较高（${Math.round(
              submitted.similarity.maxSimilarity * 100,
            )}%），建议差异化后再投。`
          : '已提交竞标，席位 +1',
      );
      setShowBidForm(false);
      loadSeats(id); // 刷新席位列表
    } catch (err) {
      setBidOk(false);
      setBidMsg(err instanceof Error ? err.message : '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  async function reloadTaskAndSeats() {
    if (!id) return;
    try {
      const [taskData, seatBids] = await Promise.all([
        getMarketplaceTask(id),
        getTaskSeatBids(id),
      ]);
      setTask(taskData);
      setSeats(Array.isArray(seatBids) ? seatBids : []);
    } catch {
      /* 刷新失败不打断页面 */
    }
  }

  // 雇主选标（PRD §5.6.2）：仅任务发布者可操作，选标后不可反悔
  async function handleSelectBid(bidId: string) {
    if (!id || !token) return;
    if (!window.confirm('确认选择该工作室的方案吗？选标后将立即锁定并创建项目，不可反悔。')) {
      return;
    }
    setActionBusy(true);
    setActionMsg('');
    try {
      await selectMarketplaceBid(token, { taskId: id, bidId });
      setActionOk(true);
      setActionMsg('已选标，任务进入签约阶段。');
      await reloadTaskAndSeats();
    } catch (err) {
      setActionOk(false);
      setActionMsg(err instanceof Error ? err.message : '选标失败，请稍后重试');
    } finally {
      setActionBusy(false);
    }
  }

  // 雇主全部驳回（PRD §5.6.3）：清空当前轮竞标并重开
  async function handleRejectAll() {
    if (!id || !token) return;
    if (!window.confirm('全部驳回将清空当前轮全部竞标并重新开放竞标，确定执行吗？')) {
      return;
    }
    setActionBusy(true);
    setActionMsg('');
    try {
      await rejectAllMarketplaceBids(token, id);
      setActionOk(true);
      setActionMsg('已全部驳回，任务已重新开放竞标。');
      await reloadTaskAndSeats();
    } catch (err) {
      setActionOk(false);
      setActionMsg(err instanceof Error ? err.message : '操作失败，请稍后重试');
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 py-2">
      <header className="rounded-2xl border border-[color:var(--border)] bg-white p-5">
        <h1 className="text-lg font-semibold text-[var(--text-900)]">{task.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--text-600)]">
          <span>{budget}</span>
          {task.seatTaken != null && task.seatLimit != null && (
            <span>
              席位 {task.seatTaken}/{task.seatLimit}
            </span>
          )}
          <span>当前有 {seats.length} 个工作室参与竞标</span>
        </div>
      </header>

      {actionMsg && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${
            actionOk
              ? 'border-[color:var(--border)] bg-[var(--state-success-bg,var(--background-50))] text-[var(--state-success-text)]'
              : 'border-[color:var(--border)] bg-[var(--background-100)] text-[var(--state-error)]'
          }`}
        >
          {actionOk ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <span aria-hidden className="text-base leading-none">
              !
            </span>
          )}
          {actionMsg}
        </div>
      )}

      {/* Agent Owner 手动参与竞标入口（雇主本人不展示，避免自标） */}
      {openForBid && !isEmployer && (
        <section className="rounded-2xl border border-[color:var(--border)] bg-white p-5" aria-label="参与竞标">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[var(--text-800)]">
              <Rocket className="h-5 w-5 text-[var(--brand-500)]" />
              <span className="font-semibold">我的工作室参与竞标</span>
            </div>
            {!showBidForm && !alreadyBid && canSubmit && (
              <button
                type="button"
                onClick={() => setShowBidForm(true)}
                className="btn-cs btn-primary min-h-11"
              >
                参与竞标
              </button>
            )}
          </div>

          {!user?.id ? (
            <p className="mt-3 text-sm text-[var(--text-500)]">登录后可用名下工作室参与竞标。</p>
          ) : !wsLoaded ? (
            <p className="mt-3 text-sm text-[var(--text-500)]">正在加载你的工作室…</p>
          ) : !myWorkspace ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-[var(--text-500)]">
                你还没有 AI 工作室。一键开通默认工作室后，即可用「我的工作室」立即参与本任务竞标。
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={provisioning}
                  onClick={handleProvisionDefault}
                  className="btn-cs btn-primary min-h-11 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {provisioning ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      开通中…
                    </>
                  ) : (
                    <>
                      <Store className="h-4 w-4" />
                      一键开通我的 AI 工作室
                    </>
                  )}
                </button>
                <Link
                  to="/workspace"
                  className="text-sm font-medium text-[var(--brand-600)] hover:underline"
                >
                  前往我的工作室
                </Link>
                {bidMsg && (
                  <span
                    className={`text-sm ${
                      bidOk ? 'text-[var(--state-success-text)]' : 'text-[var(--state-error)]'
                    }`}
                  >
                    {bidMsg}
                  </span>
                )}
              </div>
            </div>
          ) : !wsUsable ? (
            <p className="mt-3 text-sm text-[var(--text-500)]">
              你的工作室「{myWorkspace.name}」当前不可参与竞标（状态：
              {myWorkspace.displayStatus}）。请到
              <Link to="/workspace" className="mx-1 font-semibold text-[var(--brand-600)]">
                我的工作室
              </Link>
              检查状态。
            </p>
          ) : alreadyBid ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-[var(--text-600)]">
              <CheckCircle2 className="h-4 w-4 text-[var(--state-success-text)]" />
              你的工作室「{myWorkspace.name}」已参与本任务竞标，等待雇主选标。
            </p>
          ) : !showBidForm ? (
            <p className="mt-3 text-sm text-[var(--text-500)]">
              将以「{myWorkspace.name}」的名义立即占取一个席位（无需等待轮询窗口）。
            </p>
          ) : null}

          {showBidForm && mineWsId && (
            <div className="mt-4 space-y-3 rounded-xl bg-[var(--background-100)] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-700)]">
                <Store className="h-4 w-4 text-[var(--icon-500)]" />
                参与工作室：{myWorkspace?.name}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="min-w-0">
                  <span className="mb-1.5 block text-xs font-semibold text-[var(--text-600)]">
                    报价（整数元） *
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    placeholder={task.budgetMaxCny != null ? `不超过 ${task.budgetMaxCny}` : '你的报价'}
                    className="h-11 w-full rounded-xl border border-[color:var(--border)] bg-white px-3 text-sm text-[var(--text-800)] outline-none focus:border-[var(--brand-500)] focus:ring-4 focus:ring-blue-500/10"
                  />
                </label>
                <label className="min-w-0">
                  <span className="mb-1.5 block text-xs font-semibold text-[var(--text-600)]">
                    预计交付日期（可选）
                  </span>
                  <input
                    type="date"
                    value={delivery}
                    onChange={(event) => setDelivery(event.target.value)}
                    className="h-11 w-full rounded-xl border border-[color:var(--border)] bg-white px-3 text-sm text-[var(--text-800)] outline-none focus:border-[var(--brand-500)] focus:ring-4 focus:ring-blue-500/10"
                  />
                </label>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-[var(--text-600)]">
                  方案简述（可选）
                </span>
                <textarea
                  rows={2}
                  value={plan}
                  onChange={(event) => setPlan(event.target.value)}
                  placeholder="简要说明你的执行思路与优势"
                  className="w-full resize-none rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-800)] outline-none focus:border-[var(--brand-500)] focus:ring-4 focus:ring-blue-500/10"
                />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={handleSubmitBid}
                  className="btn-cs btn-primary min-h-11 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      提交中…
                    </>
                  ) : (
                    '确认参与竞标'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowBidForm(false);
                    setBidMsg('');
                  }}
                  className="btn-cs min-h-11"
                >
                  取消
                </button>
                {bidMsg && (
                  <span
                    className={`text-sm ${
                      bidOk ? 'text-[var(--state-success-text)]' : 'text-[var(--state-error)]'
                    }`}
                  >
                    {bidMsg}
                  </span>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {seats.length === 0 ? (
        <WorkbenchStatePanel
          icon={Gavel}
          title="暂无竞标"
          description="席位开放中，竞标提交后这里会展示竞标工作室。"
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-[var(--text-500)]">
              共 {seats.length} 家工作室参与竞标
              {unclaimedTask && (
                <span className="ml-2 text-xs text-[var(--text-400)]">
                  （该任务暂无归属雇主，选择/驳回后你将成为该任务雇主）
                </span>
              )}
            </span>
            <div className="flex flex-wrap items-center gap-3">
              {isEmployer && openForBid && seats.length > 0 && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={handleRejectAll}
                  className="btn-cs min-h-9 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionBusy ? '处理中…' : '全部驳回并重开竞标'}
                </button>
              )}
              <label className="flex items-center gap-2 text-sm text-[var(--text-600)]">
                <span>排序</span>
                <select
                  value={sortBy}
                  onChange={(event) =>
                    setSortBy(event.target.value as SeatSortKey)
                  }
                  className="h-9 rounded-lg border border-[color:var(--border)] bg-white px-2 text-sm text-[var(--text-800)] outline-none focus:border-[var(--brand-500)] focus:ring-4 focus:ring-blue-500/10"
                >
                  {SEAT_SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <ul className="space-y-3">
            {sortedSeats.map((seat) => {
              const name = seat.workspaceName ?? seat.bid.workspaceName ?? '未知工作室';
              const logo = seat.workspaceLogoUrl ?? seat.bid.workspaceLogoUrl;
              const logoRenderable = !!logo && /^https?:\/\//i.test(logo);
              const initial = name.trim().charAt(0) || '?';
              const isMine = mineWsId != null && seat.bid.workspaceId === mineWsId;
              return (
                <li
                  key={seat.bid.id}
                  className="flex items-start gap-3 rounded-2xl border border-[color:var(--border)] bg-white p-4"
                >
                  {logoRenderable ? (
                    <img
                      src={logo}
                      alt={`${name} 头像`}
                      className="h-11 w-11 shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--background-200)] text-base font-semibold text-[var(--text-700)]"
                    >
                      {initial}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1.5 font-medium text-[var(--text-900)]">
                        <Store className="h-4 w-4 text-[var(--text-400)]" />
                        {name}
                      </span>
                      {isMine && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-50)] px-2 py-0.5 text-xs font-medium text-[var(--brand-600)]">
                          我的工作室
                        </span>
                      )}
                      {seat.platformRecommended && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-50)] px-2 py-0.5 text-xs font-medium text-[var(--brand-600)]">
                          <Sparkles className="h-3 w-3" />
                          平台推荐
                        </span>
                      )}
                    </div>
                    {seat.bid.planSummary && (
                      <p className="mt-1 line-clamp-3 text-sm text-[var(--text-600)]">
                        {seat.bid.planSummary}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-[var(--text-500)]">
                      <span className="text-sm font-semibold text-[var(--brand-600)]">
                        ¥{seat.bid.priceCny}
                      </span>
                      {seat.bid.estimatedDeliveryAt && (
                        <span>
                          预计交付 {new Date(seat.bid.estimatedDeliveryAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {isEmployer && openForBid && (
                      <div className="mt-3">
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => handleSelectBid(seat.bid.id)}
                          className="btn-cs btn-primary btn-sm disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          选择此方案
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
