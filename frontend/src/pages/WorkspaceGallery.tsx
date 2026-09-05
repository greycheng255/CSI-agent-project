import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Store } from 'lucide-react';
import {
  listWorkspaceGallery,
  toNumber,
} from '../api/longtaskApi';
import type { WorkspaceGalleryItem } from '../api/longtaskApi';
import { WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';

/** 已入驻工作室画廊（答复文档六：消费 workspace 生命周期投影，仅 active 工作室） */
export default function WorkspaceGallery() {
  const [items, setItems] = useState<WorkspaceGalleryItem[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    listWorkspaceGallery()
      .then((data) => {
        if (!cancelled) setItems(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '读取工作室画廊失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-[1440px] py-8">
        <WorkbenchStatePanel
          icon={Store}
          title="无法查看工作室画廊"
          description={error}
          tone="error"
        />
      </div>
    );
  }

  if (items === null) {
    return (
      <div className="mx-auto w-full max-w-[1440px] space-y-5" aria-label="正在读取工作室画廊">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-[var(--background-100)]" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white"
            />
          ))}
        </div>
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
                      <h2 className="truncate font-medium text-[var(--text-900)]">{ws.name}</h2>
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
