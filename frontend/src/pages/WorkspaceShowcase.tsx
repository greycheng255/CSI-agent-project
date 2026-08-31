import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Award,
  BadgeCheck,
  Clock,
  Megaphone,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
} from 'lucide-react';
import { getWorkspaceBySlug, toNumber } from '../api/longtaskApi';
import type {
  WorkspaceShowcaseData,
  WorkspaceShowcaseCase,
} from '../api/longtaskApi';
import { WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';

const NEW_SHOP_THRESHOLD = 3; // 历史任务 < 3 单显示「新店」标识（PRD §5.6.7）

type ShowcaseState =
  | { status: 'loading'; workspace: null; error: '' }
  | { status: 'ready'; workspace: WorkspaceShowcaseData; error: '' }
  | { status: 'error'; workspace: null; error: string };

/** 数值百分位格式化（信用数据脱敏展示：仅展示聚合指标） */
function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function normalizeCases(
  cases: WorkspaceShowcaseCase[] | null | undefined,
): WorkspaceShowcaseCase[] {
  if (!Array.isArray(cases)) return [];
  return cases.filter(
    (c) => typeof c?.title === 'string' && c.title.trim().length > 0,
  );
}

function ServiceCommitments({
  commitments,
}: {
  commitments: Record<string, unknown>;
}) {
  const entries = Object.entries(commitments ?? {});
  if (entries.length === 0) {
    return <p className="text-sm text-[var(--text-400)]">暂无服务承诺</p>;
  }
  return (
    <ul className="space-y-2.5">
      {entries.map(([key, value]) => (
        <li key={key} className="flex items-start gap-2.5 text-sm text-[var(--text-700)]">
          <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-600)]" />
          <span className="min-w-0 break-words">{String(value)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function WorkspaceShowcase() {
  const { slug } = useParams();
  const [state, setState] = useState<ShowcaseState>({
    status: 'loading',
    workspace: null,
    error: '',
  });

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    getWorkspaceBySlug(slug)
      .then((workspace) => {
        if (cancelled) return;
        if (!workspace) {
          setState({ status: 'error', workspace: null, error: '未找到该 AI 工作室' });
          return;
        }
        setState({ status: 'ready', workspace, error: '' });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          status: 'error',
          workspace: null,
          error:
            error instanceof Error ? error.message : '读取 AI 工作室失败',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.status === 'loading') {
    return (
      <div className="mx-auto w-full max-w-[1440px] space-y-5" aria-label="正在读取 AI 工作室">
        <div className="h-8 w-36 animate-pulse rounded-lg bg-[var(--background-100)]" />
        <div className="h-36 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
          <div className="h-72 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
          <div className="h-72 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="mx-auto w-full max-w-3xl py-8">
        <WorkbenchStatePanel
          icon={Store}
          title="无法查看该 AI 工作室"
          description={state.error}
          tone="error"
          action={
            <Link to="/" className="btn-cs btn-primary btn-sm">
              返回首页
            </Link>
          }
        />
      </div>
    );
  }

  const ws = state.workspace;
  const isNewShop = toNumber(ws.completedTasksCount) < NEW_SHOP_THRESHOLD;
  const avgRating = toNumber(ws.avgRating);
  const onTimeRate = toNumber(ws.onTimeRate);
  const disputeRate = toNumber(ws.disputeRate);
  const cases = normalizeCases(ws.showcaseCases);
  const tags = Array.isArray(ws.capabilityTags)
    ? ws.capabilityTags.filter((t) => typeof t === 'string' && t.trim())
    : [];
  const suspended = ws.displayStatus !== 'active';

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <Link
        to="/"
        className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-[var(--brand-600)] hover:text-[var(--brand-700)]"
      >
        <ArrowLeft className="h-4 w-4" />
        返回首页
      </Link>

      {suspended && (
        <div className="flex items-center gap-2.5 rounded-xl border border-[color:var(--warning-border,var(--border))] bg-[var(--warning-50,fdf6ec)] px-4 py-3 text-sm text-[var(--warning-700,#8a5a00)]">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          {ws.displayStatus === 'frozen'
            ? '该工作室当前处于冻结状态，暂不参与平台活动。'
            : '该工作室当前处于暂停状态，展示内容可能未更新。'}
        </div>
      )}

      {/* 头部：品牌 + 新店标识 */}
      <header className="flex flex-col gap-5 border-b border-[color:var(--border)] pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--v3-grad-brand)] text-lg font-bold text-[var(--background-50)]"
            aria-label="工作室头像"
          >
            {ws.logoUrl ? (
              <img
                src={ws.logoUrl}
                alt={`${ws.name} logo`}
                className="h-14 w-14 rounded-full object-cover"
              />
            ) : (
              (ws.name || 'W').slice(0, 2)
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-bold tracking-tight text-[var(--text-900)]">
                {ws.name}
              </h1>
              {isNewShop && (
                <span
                  className="rounded-full bg-[var(--brand-50)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-600)]"
                  aria-label="新店标识"
                >
                  新店
                </span>
              )}
              {!isNewShop && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-50)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-600)]">
                  <Sparkles className="h-3 w-3" />
                  资深工作室
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-[var(--text-500)]">@{ws.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-[var(--text-500)]">
          <Store className="h-4 w-4" />
          <span>CSI AI 工作室</span>
        </div>
      </header>

      {ws.announcement && (
        <div className="flex items-start gap-3 rounded-2xl border border-[color:var(--border)] bg-[var(--background-50)] px-5 py-4">
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-600)]" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--text-400)]">首页公告</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-800)]">
              {ws.announcement}
            </p>
          </div>
        </div>
      )}

      {/* 正文：左主内容（简介 + 案例），右侧栏（能力/承诺/信用） */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <div className="space-y-6">
          <section className="card-cs p-6">
            <h2 className="mb-3 text-base font-semibold text-[var(--text-900)]">工作室简介</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-600)]">
              {ws.bio || '该工作室暂未填写简介。'}
            </p>
          </section>

          <section className="card-cs p-6" aria-label="历史交付案例">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--text-900)]">历史交付案例</h2>
              <span className="text-xs text-[var(--text-400)]">共 {cases.length} 个</span>
            </div>
            {cases.length === 0 ? (
              <p className="text-sm text-[var(--text-400)]">
                暂无公开案例，可通过服务承诺与信用数据了解该工作室。
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {cases.map((item, index) => (
                  <article
                    key={`${item.title}-${index}`}
                    className="rounded-xl border border-[color:var(--border)] bg-[var(--background-25,var(--background))] p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-[var(--text-800)]">
                        {item.title}
                      </h3>
                      <span className="shrink-0 rounded-full bg-[var(--background-100)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-500)]">
                        {item.permission === 'review_only' ? '仅评审可见' : '公开'}
                      </span>
                    </div>
                    {item.summary && (
                      <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[var(--text-500)]">
                        {item.summary}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="card-cs p-6">
            <h2 className="mb-3 text-base font-semibold text-[var(--text-900)]">能力标签</h2>
            {tags.length === 0 ? (
              <p className="text-sm text-[var(--text-400)]">暂无能力标签</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-[color:var(--brand-100,var(--border))] bg-[var(--brand-50)] px-3 py-1 text-xs font-medium text-[var(--brand-600)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="card-cs p-6">
            <h2 className="mb-3 text-base font-semibold text-[var(--text-900)]">服务承诺</h2>
            <ServiceCommitments commitments={ws.serviceCommitments ?? {}} />
          </section>

          <section className="card-cs p-6" aria-label="信用数据">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--text-900)]">信用数据</h2>
              <span className="text-[10px] text-[var(--text-400)]">平台自动生成</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-[var(--background-50)] p-3 text-center">
                <Award className="mx-auto mb-1 h-4 w-4 text-[var(--brand-600)]" />
                <p className="text-lg font-bold text-[var(--text-900)]">
                  {toNumber(ws.completedTasksCount)}
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-400)]">完成任务</p>
              </div>
              <div className="rounded-xl bg-[var(--background-50)] p-3 text-center">
                <Star className="mx-auto mb-1 h-4 w-4 fill-[var(--brand-600)] text-[var(--brand-600)]" />
                <p className="text-lg font-bold text-[var(--text-900)]">
                  {avgRating.toFixed(1)}
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-400)]">平均评分</p>
              </div>
              <div className="rounded-xl bg-[var(--background-50)] p-3 text-center">
                <Clock className="mx-auto mb-1 h-4 w-4 text-[var(--brand-600)]" />
                <p className="text-lg font-bold text-[var(--text-900)]">
                  {formatPercent(onTimeRate)}
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-400)]">按时交付率</p>
              </div>
              <div className="rounded-xl bg-[var(--background-50)] p-3 text-center">
                <RefreshCw className="mx-auto mb-1 h-4 w-4 text-[var(--brand-600)]" />
                <p className="text-lg font-bold text-[var(--text-900)]">
                  {formatPercent(disputeRate)}
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-400)]">纠纷率</p>
              </div>
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-[var(--text-300)]">
              信用数据由平台基于交付与评价记录自动计算生成，不可由工作室修改。
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}