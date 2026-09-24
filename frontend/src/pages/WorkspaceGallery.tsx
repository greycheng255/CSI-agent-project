import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Store } from 'lucide-react';
import {
  listWorkspaceGallery,
  toNumber,
} from '../api/longtaskApi';
import type { WorkspaceGalleryItem } from '../api/longtaskApi';
import { WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';
import { Skeleton, SkeletonText } from '../components/ui/Skeleton';

/** 已入驻工作室画廊（答复文档六：消费 workspace 生命周期投影，仅 active 工作室） */
export default function WorkspaceGallery() {
  const [items, setItems] = useState<WorkspaceGalleryItem[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    listWorkspaceGallery()
      .then((data) => {
        setItems(Array.isArray(data) ? data : []);
        setError('');
      })
      .catch((err: unknown) => {
        setItems([]);
        setError(err instanceof Error ? err.message : '读取工作室画廊失败');
      });
  }, []);

  const retry = () => {
    setError('');
    setItems(null);
    load();
  };

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-[1440px] py-8">
        <WorkbenchStatePanel
          icon={Store}
          title="无法查看工作室画廊"
          description={error}
          tone="error"
          action={<button type="button" onClick={retry} className="btn-cs btn-primary btn-sm">重试</button>}
        />
      </div>
    );
  }

  if (items === null) {
    return (
      <div
        className="mx-auto w-full max-w-[1440px] space-y-5 py-2"
        aria-busy="true"
        aria-label="正在读取工作室画廊"
      >
        <div>
          <Skeleton className="h-6 w-40" rounded="sm" />
          <Skeleton className="mt-2 h-4 w-64" rounded="sm" />
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <li key={index} className="rounded-2xl border border-[color:var(--border)] bg-white p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12" rounded="lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-28" rounded="sm" />
                  <Skeleton className="h-3 w-36" rounded="sm" />
                </div>
              </div>
              <SkeletonText lines={2} className="mt-3" />
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Skeleton className="h-5 w-16" rounded="pill" />
                <Skeleton className="h-5 w-14" rounded="pill" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5 py-2">
      <header>
        <h1 className="text-xl font-semibold text-[var(--text-900)]">已入驻 AI 工作室</h1>
        <p className="mt-1 text-sm text-[var(--text-500)]">
          共 {items.length} 家工作室入驻，点击卡片查看展示页。
        </p>
      </header>

      {items.length === 0 ? (
        <WorkbenchStatePanel
          icon={Store}
          title="还没有工作室入驻"
          description="工作室开通并同步后，这里会展示已入驻的 AI 工作室。"
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((ws) => {
            const initial = ws.name.trim().charAt(0) || '?';
            return (
              <li key={ws.id}>
                <Link
                  to={`/longtask/workspaces/${encodeURIComponent(ws.slug)}`}
                  className="flex h-full flex-col rounded-2xl border border-[color:var(--border)] bg-white p-4 transition hover:border-[var(--brand-300)] hover:shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    {ws.logoUrl ? (
                      <img
                        src={ws.logoUrl}
                        alt={`${ws.name} 头像`}
                        className="h-12 w-12 shrink-0 rounded-xl object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--background-200)] text-lg font-semibold text-[var(--text-700)]"
                      >
                        {initial}
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate font-medium text-[var(--text-900)]">
                          {ws.name}
                        </h2>
                        {toNumber(ws.completedTasksCount) < 3 && (
                          <span className="shrink-0 rounded-full bg-[var(--brand-50)] px-2 py-0.5 text-[10px] font-semibold text-[var(--brand-600)]">
                            新店
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-500)]">
                        {ws.completedTasksCount} 单完成 · 评分 {toNumber(ws.avgRating).toFixed(1)}
                      </p>
                    </div>
                  </div>
                  {ws.bio && (
                    <p className="mt-2.5 line-clamp-2 text-sm text-[var(--text-600)]">{ws.bio}</p>
                  )}
                  {ws.capabilityTags && ws.capabilityTags.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {ws.capabilityTags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-[var(--background-100)] px-2 py-0.5 text-xs text-[var(--text-600)]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
