import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Star,
  Store,
} from 'lucide-react';
import {
  getRecommendedWorkspaces,
  inviteWorkspaceToTask,
  toNumber,
} from '../api/longtaskApi';
import type { RecommendedWorkspace } from '../api/longtaskApi';

interface RecommendedWorkspacesProps {
  taskId: string;
  token: string | null;
  /** 默认展开（任务刚发布时建议展开） */
  defaultOpen?: boolean;
  className?: string;
}

/** 百分比展示（信用数据脱敏：仅展示聚合指标） */
function percent(value: number): string {
  return `${Math.round(toNumber(value) * 100)}%`;
}

/**
 * 平台推荐工作室（雇主创建/发布任务后）：
 * 依据信用数据（平台自动计算，不可修改）+ 类目/标签匹配排序；分数不展示，只给推荐理由。
 * 支持一键邀请——复用 opportunity.pushed 链路把商机推给该工作室，同轮幂等。
 */
export default function RecommendedWorkspaces({
  taskId,
  token,
  defaultOpen = false,
  className = '',
}: RecommendedWorkspacesProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<RecommendedWorkspace[]>([]);
  const [candidateCount, setCandidateCount] = useState(0);
  const [inviting, setInviting] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const data = await getRecommendedWorkspaces(token, taskId);
      setItems(data.items ?? []);
      setCandidateCount(data.candidateCount ?? 0);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取平台推荐工作室失败');
    } finally {
      setLoading(false);
    }
  }, [taskId, token]);

  useEffect(() => {
    if (open && !loaded && token) void load();
  }, [open, loaded, token, load]);

  const handleInvite = async (workspaceId: string) => {
    if (!token) return;
    setInviting(workspaceId);
    setInviteError((prev) => ({ ...prev, [workspaceId]: '' }));
    try {
      const result = await inviteWorkspaceToTask(token, taskId, workspaceId);
      setItems((prev) =>
        prev.map((item) =>
          item.workspaceId === workspaceId
            ? { ...item, invited: result.invited || result.alreadyInvited }
            : item,
        ),
      );
    } catch (err) {
      setInviteError((prev) => ({
        ...prev,
        [workspaceId]:
          err instanceof Error ? err.message : '邀请失败，请稍后重试',
      }));
    } finally {
      setInviting(null);
    }
  };

  return (
    <section
      className={`rounded-2xl border border-[color:var(--brand-200)] bg-[color:var(--brand-50)]/40 ${className}`}
      aria-label="平台推荐工作室"
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Sparkles className="h-4 w-4 shrink-0 text-[var(--brand-600)]" />
          <span className="truncate text-sm font-semibold text-[var(--text-900)]">
            平台推荐工作室
          </span>
          <span className="shrink-0 text-xs text-[var(--text-500)]">
            按信用数据与类目匹配度排序
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--text-500)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-[color:var(--brand-200)] px-5 py-4">
          {!token && (
            <p className="text-xs text-[var(--text-500)]">
              登录后可查看平台为你推荐的工作室。
            </p>
          )}

          {token && loading && (
            <p className="flex items-center gap-2 text-xs text-[var(--text-500)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在计算推荐工作室……
            </p>
          )}

          {token && !loading && error && (
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-xs text-[var(--state-error)]">
                <AlertTriangle className="h-3.5 w-3.5" />
                {error}
              </p>
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] px-3 py-1 text-xs text-[var(--text-600)] hover:border-[var(--brand-300)] hover:text-[var(--brand-600)]"
              >
                <RefreshCw className="h-3 w-3" />
                重试
              </button>
            </div>
          )}

          {token && !loading && !error && loaded && items.length === 0 && (
            <p className="text-xs text-[var(--text-500)]">
              暂无可推荐的工作室（同类目工作室可能已投标或未开启平台推送）。
            </p>
          )}

          {token && !loading && !error && items.length > 0 && (
            <>
              <ul className="space-y-3">
                {items.map((item) => (
                  <li
                    key={item.workspaceId}
                    className="rounded-xl border border-[color:var(--border)] bg-white p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        {item.logoUrl ? (
                          <img
                            src={item.logoUrl}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-xl object-cover"
                          />
                        ) : (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--background-100)] text-[var(--text-400)]">
                            <Store className="h-5 w-5" />
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-semibold text-[var(--text-900)]">
                              {item.name}
                            </span>
                            {item.newShop && (
                              <span className="shrink-0 rounded-full border border-[color:var(--border)] bg-[var(--background-100)] px-2 py-0.5 text-xs text-[var(--text-600)]">
                                新店
                              </span>
                            )}
                          </div>
                          {item.bio && (
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-500)]">
                              {item.bio}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <button
                          type="button"
                          disabled={item.invited || inviting === item.workspaceId}
                          onClick={() => void handleInvite(item.workspaceId)}
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-[var(--brand-500)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-[var(--background-200)] disabled:text-[var(--text-400)]"
                        >
                          {inviting === item.workspaceId ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : item.invited ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <Send className="h-3 w-3" />
                          )}
                          {item.invited ? '已邀请' : '邀请竞标'}
                        </button>
                      </div>
                    </div>

                    {/* 信用数据四项（平台自动计算） */}
                    <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="rounded-lg bg-[var(--background-100)] px-3 py-2">
                        <dt className="text-xs text-[var(--text-400)]">完成任务</dt>
                        <dd className="text-sm font-semibold text-[var(--text-900)]">
                          {toNumber(item.credit.completedTasksCount)}
                        </dd>
                      </div>
                      <div className="rounded-lg bg-[var(--background-100)] px-3 py-2">
                        <dt className="flex items-center gap-1 text-xs text-[var(--text-400)]">
                          <Star className="h-3 w-3" />
                          平均评分
                        </dt>
                        <dd className="text-sm font-semibold text-[var(--text-900)]">
                          {toNumber(item.credit.avgRating).toFixed(1)}
                        </dd>
                      </div>
                      <div className="rounded-lg bg-[var(--background-100)] px-3 py-2">
                        <dt className="flex items-center gap-1 text-xs text-[var(--text-400)]">
                          <Clock className="h-3 w-3" />
                          按时交付率
                        </dt>
                        <dd className="text-sm font-semibold text-[var(--text-900)]">
                          {percent(item.credit.onTimeRate)}
                        </dd>
                      </div>
                      <div className="rounded-lg bg-[var(--background-100)] px-3 py-2">
                        <dt className="text-xs text-[var(--text-400)]">纠纷率</dt>
                        <dd className="text-sm font-semibold text-[var(--text-900)]">
                          {percent(item.credit.disputeRate)}
                        </dd>
                      </div>
                    </dl>

                    {item.reasons.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {item.reasons.map((reason) => (
                          <span
                            key={reason}
                            className="rounded-full bg-[color:var(--brand-50)] px-2 py-0.5 text-xs text-[var(--brand-700)]"
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                    )}

                    {inviteError[item.workspaceId] && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--state-error)]">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {inviteError[item.workspaceId]}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {candidateCount > items.length && (
                <p className="mt-3 text-xs text-[var(--text-500)]">
                  共 {candidateCount} 家符合条件，此处按推荐分展示前 {items.length} 家。
                </p>
              )}
              <p className="mt-3 text-xs leading-5 text-[var(--text-400)]">
                信用数据由平台基于交付与验收记录自动计算生成，工作室不可修改；推荐仅代表匹配度，不代表平台对交付质量的背书。
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}