import { LayoutDashboard } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { WorkbenchNavigationItem } from '../config/workbenchNavigation';

type WorkbenchShellProps = {
  title: string;
  description: string;
  items: WorkbenchNavigationItem[];
  accountItems?: WorkbenchNavigationItem[];
  isItemActive: (pathname: string, target: string) => boolean;
  children: ReactNode;
};

export default function WorkbenchShell({
  title,
  description,
  items,
  accountItems = [],
  isItemActive,
  children,
}: WorkbenchShellProps) {
  const location = useLocation();

  const renderItems = (navigationItems: WorkbenchNavigationItem[]) => navigationItems.map((item) => {
    const active = isItemActive(location.pathname, item.to);
    return (
      <NavLink
        key={item.to}
        to={item.to}
        aria-current={active ? 'page' : undefined}
        className={`group flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors lg:w-full ${
          active
            ? 'bg-[var(--brand-50)] text-[var(--brand-700)]'
            : 'text-[var(--text-600)] hover:bg-[var(--background-100)] hover:text-[var(--text-900)]'
        }`}
      >
        <item.Icon className={`h-4 w-4 shrink-0 ${active ? 'text-[var(--brand-600)]' : 'text-[var(--text-400)] group-hover:text-[var(--text-600)]'}`} />
        <span className="whitespace-nowrap lg:min-w-0 lg:flex-1">
          <span className="block">{item.label}</span>
          <span className={`mt-0.5 hidden text-[11px] font-normal leading-4 lg:block ${active ? 'text-[var(--brand-600)]' : 'text-[var(--text-400)]'}`}>
            {item.description}
          </span>
        </span>
      </NavLink>
    );
  });

  return (
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[248px_minmax(0,1fr)] xl:gap-6">
      <aside className="min-w-0 rounded-2xl border border-[color:var(--border)] bg-white px-4 py-5 lg:sticky lg:top-20 lg:px-5 lg:py-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)] text-[var(--brand-600)]">
            <LayoutDashboard className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-[var(--text-900)]">{title}</h1>
            <p className="mt-0.5 truncate text-xs text-[var(--text-500)]">{description}</p>
          </div>
        </div>

        <nav aria-label={`${title}导航`} className="mt-4 flex gap-2 overflow-x-auto border-t border-[color:var(--border)] pt-4 lg:grid lg:gap-1 lg:overflow-visible">
          {renderItems(items)}
        </nav>

        {accountItems.length > 0 && (
          <div className="mt-4 border-t border-[color:var(--border)] pt-4">
            <p className="mb-2 hidden px-3 text-xs font-medium text-[var(--text-400)] lg:block">账户</p>
            <nav aria-label={`${title}账户导航`} className="flex gap-2 overflow-x-auto lg:grid lg:gap-1 lg:overflow-visible">
              {renderItems(accountItems)}
            </nav>
          </div>
        )}
      </aside>

      <main className="min-w-0">{children}</main>
    </div>
  );
}
