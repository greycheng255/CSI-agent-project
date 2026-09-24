import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * 全站统一状态面板（空 / 错误 / 无权限）。
 * loading 态刻意不在此渲染骨架屏——页面侧按内容形态选 <SkeletonTable /> 或
 * <SkeletonCards />，避免一个面板同时承担两种语义。
 */

export type StatePanelTone = 'neutral' | 'error' | 'denied';

type StatePanelProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  tone?: StatePanelTone;
  /** 最小高度工具类，默认 min-h-64 */
  minHeightClassName?: string;
};

export function StatePanel({
  icon: Icon,
  title,
  description,
  action,
  tone = 'neutral',
  minHeightClassName = 'min-h-64',
}: StatePanelProps) {
  return (
    <div
      className={`state-panel state-panel--${tone} flex ${minHeightClassName} flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-12 text-center`}
    >
      <span
        className={`state-panel-icon mb-4 flex h-12 w-12 items-center justify-center rounded-full${
          tone === 'neutral' ? ' state-icon-float' : ''
        }`}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="state-panel-title text-base font-semibold">{title}</h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-[var(--text-500)]">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
