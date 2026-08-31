import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Store } from 'lucide-react';
import { getWorkspaceByOwner } from '../api/longtaskApi';
import { useAuthStore } from '../store/authStore';

type EntryState =
  | { status: 'loading'; slug: null; error: '' }
  | { status: 'ready'; slug: string; error: '' }
  | { status: 'missing'; slug: null; error: string }
  | { status: 'error'; slug: null; error: string };

/**
 * AI 工作室入口（改造语义：卖家主体从「Agent 商品」升级为「工作室」，绑定既有用户）：
 * - /longtask/workspaces/mine       → 当前登录用户的工作室
 * - /longtask/workspaces/by-owner/:ownerId → 指定 Agent Owner 的工作室（Agent 详情/卡片跳转）
 * 命中后重定向到工作室展示页；未开通时给出空态引导。
 */
export default function OwnerWorkspaceEntry() {
  const { ownerId } = useParams();
  const user = useAuthStore((s) => s.user);
  const [state, setState] = useState<EntryState>({
    status: 'loading',
    slug: null,
    error: '',
  });

  useEffect(() => {
    const target = ownerId || user?.id;
    if (!target) {
      setState({
        status: 'missing',
        slug: null,
        error: '登录后即可查看与管理你的 AI 工作室',
      });
      return;
    }
    let cancelled = false;
    getWorkspaceByOwner(target)
      .then((workspace) => {
        if (cancelled) return;
        if (!workspace) {
          setState({ status: 'missing', slug: null, error: '你还没有开通 AI 工作室' });
        } else {
          setState({ status: 'ready', slug: workspace.slug, error: '' });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          status: 'error',
          slug: null,
          error: error instanceof Error ? error.message : '读取 AI 工作室失败',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId, user?.id]);

  if (state.status === 'ready') {
    return <Navigate to={`/longtask/workspaces/${state.slug}`} replace />;
  }

  if (state.status === 'loading') {
    return (
      <div className="mx-auto w-full max-w-[1440px] space-y-5" aria-label="正在读取 AI 工作室">
        <div className="h-8 w-36 animate-pulse rounded-lg bg-[var(--background-100)]" />
        <div className="h-36 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
      </div>
    );
  }

  const missing = state.status === 'missing';
  return (
    <div className="mx-auto w-full max-w-3xl py-8">
      <div className="card-cs flex flex-col items-center gap-4 p-10 text-center">
        <span className="icon-tile-cs">
          <Store className="h-6 w-6" />
        </span>
        <h1 className="text-lg font-bold tracking-tight text-[var(--text-900)]">
          {missing ? '尚未开通 AI 工作室' : '读取 AI 工作室失败'}
        </h1>
        <p className="max-w-md text-sm leading-relaxed text-[var(--text-500)]">
          {state.error}
        </p>
        {missing && !user && (
          <Link to="/login" className="btn-cs btn-primary btn-sm mt-2">
            登录后查看
          </Link>
        )}
        <Link to="/" className="btn-cs btn-ghost btn-sm">
          返回首页
        </Link>
      </div>
    </div>
  );
}