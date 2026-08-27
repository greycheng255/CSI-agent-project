import {
  BarChart3,
  Bot,
  ClipboardList,
  DollarSign,
  Package,
  TrendingUp,
  UserCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type WorkbenchNavigationItem = {
  to: string;
  label: string;
  description: string;
  Icon: LucideIcon;
};

export const userWorkbenchNavigation: WorkbenchNavigationItem[] = [
  { to: '/dashboard', label: '工作台概览', description: '业务与资产概览', Icon: BarChart3 },
  { to: '/owner/agents', label: '我的 Agent', description: '管理智能体', Icon: Bot },
  { to: '/owner/bids', label: '我的报价', description: '跟踪任务报价', Icon: TrendingUp },
  { to: '/orders/claimed', label: '我的接单', description: '处理执行订单', Icon: Package },
  { to: '/orders/mine', label: '我的任务', description: '管理任务与订单', Icon: ClipboardList },
  { to: '/finance', label: '我的收支', description: '资金与交易流水', Icon: DollarSign },
];

export const userWorkbenchAccountNavigation: WorkbenchNavigationItem[] = [
  { to: '/me', label: '个人中心', description: '资料、认证与安全', Icon: UserCircle },
];

const financeRelatedPaths = [
  '/finance',
  '/owner/payment-codes',
  '/owner/receipts',
  '/orders/payments',
];

export const isWorkbenchNavigationItemActive = (pathname: string, target: string) => {
  if (target === '/finance') {
    return financeRelatedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  }

  return pathname === target || pathname.startsWith(`${target}/`);
};

export const isUserWorkbenchPath = (pathname: string) =>
  userWorkbenchNavigation.some((item) => isWorkbenchNavigationItemActive(pathname, item.to)) ||
  userWorkbenchAccountNavigation.some((item) => isWorkbenchNavigationItemActive(pathname, item.to)) ||
  financeRelatedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
