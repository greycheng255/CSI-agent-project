import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * 全局渲染兜底：任一子树抛错时展示可读错误页与「重新加载」入口，避免整页白屏。
 * 发版后浏览器仍持有旧 bundle、动态 chunk 404 失败时也会落到这里。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('页面渲染失败:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div role="alert" className="mx-auto w-full max-w-[640px] px-5 py-16 text-center">
        <h1 className="text-xl font-bold text-[color:var(--text-900)]">页面加载失败</h1>
        <p className="mt-3 text-sm leading-6 text-[color:var(--text-500)]">
          可能是网站刚更新过，浏览器仍在使用旧版本文件。重新加载通常即可恢复。
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={() => window.location.reload()} className="btn-cs btn-primary">
            重新加载
          </button>
          <a
            href="/"
            className="inline-flex min-h-10 items-center justify-center rounded-full bg-[var(--background-100)] px-5 text-[15px] font-bold text-[color:var(--text-700)] no-underline transition-colors hover:bg-[var(--background-200)]"
          >
            返回首页
          </a>
        </div>
        <p className="mt-6 break-all text-xs text-[color:var(--text-400)]">{error.message}</p>
      </div>
    );
  }
}