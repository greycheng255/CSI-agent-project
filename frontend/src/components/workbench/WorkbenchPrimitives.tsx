import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

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

export function WorkbenchStatePanel({
  icon: Icon,
  title,
  description,
  action,
  tone = 'neutral',
}: WorkbenchStatePanelProps) {
  const isError = tone === 'error';

  return (
    <div
      className={`flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-12 text-center ${
        isError
          ? 'border-[color:var(--state-error)] bg-[var(--state-error-surface)]'
          : 'border-[color:var(--border)] bg-white'
      }`}
    >
      <span
        className={`mb-4 flex h-12 w-12 items-center justify-center rounded-full ${
          isError
            ? 'bg-white text-[var(--state-error)]'
            : 'bg-[var(--background-100)] text-[var(--text-400)]'
        }`}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className={`text-base font-semibold ${isError ? 'text-[var(--state-error)]' : 'text-[var(--text-800)]'}`}>
        {title}
      </h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-[var(--text-500)]">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
