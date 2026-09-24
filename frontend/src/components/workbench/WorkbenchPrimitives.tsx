import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { StatePanel, type StatePanelTone } from '../ui/StatePanel';

type WorkbenchPageHeaderProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  eyebrow?: string;
  actions?: ReactNode;
};

export function WorkbenchPageHeader({
  icon: Icon,
  title,
  description,
  eyebrow,
  actions,
}: WorkbenchPageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-[color:var(--border)] pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)] text-[var(--brand-600)]">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--brand-600)]">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-900)]">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--text-500)]">{description}</p>
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </header>
  );
}

type WorkbenchStatePanelProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  tone?: 'neutral' | 'error';
};

/**
 * 工作台状态面板。已统一到全站 <StatePanel />，此处仅保留原签名以兼容既有调用。
 * 新代码请直接使用 components/ui/StatePanel。
 */
export function WorkbenchStatePanel({
  icon,
  title,
  description,
  action,
  tone = 'neutral',
}: WorkbenchStatePanelProps) {
  return (
    <StatePanel
      icon={icon}
      title={title}
      description={description}
      action={action}
      tone={tone as StatePanelTone}
    />
  );
}
