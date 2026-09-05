import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Gavel, Sparkles, Store } from 'lucide-react';
import {
  getMarketplaceTask,
  getTaskSeatBids,
} from '../api/longtaskApi';
import type {
  MarketplaceSeatBid,
  MarketplaceTaskInfo,
} from '../api/longtaskApi';
import { WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';

/**
 * 长任务竞标席位页（PRD §5.6.1）：雇主查看当前轮竞标方。
 * 竞标方名称/头像用提交时的席位快照（答复文档六.3），免逐条查询；
 * 综合分仅用于后端排序，不对雇主展示（PRD §5.6.1）。
 */
export default function LongTaskSeats() {
  const { id } = useParams();
  const [task, setTask] = useState<MarketplaceTaskInfo | null>(null);
  const [seats, setSeats] = useState<MarketplaceSeatBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

      {seats.length === 0 ? (
        <WorkbenchStatePanel
          icon={Gavel}
          title="暂无竞标"
          description="席位开放中，竞标提交后这里会展示竞标工作室。"
        />
      ) : (
        <ul className="space-y-3">
          {seats.map((seat) => {
            const name = seat.workspaceName ?? seat.bid.workspaceName ?? '未知工作室';
            const logo = seat.workspaceLogoUrl ?? seat.bid.workspaceLogoUrl;
            // §21.4：仅绝对 URL 可直接渲染；相对路径待 W1 详情回退链路（联调样本到位后接入），暂走首字母兜底
            const logoRenderable = !!logo && /^https?:\/\//i.test(logo);
            const initial = name.trim().charAt(0) || '?';
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
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
