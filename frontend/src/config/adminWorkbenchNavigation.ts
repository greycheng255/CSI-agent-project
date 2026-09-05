import { BarChart3, Bot, CreditCard, DollarSign, Gavel, KeyRound, QrCode, Shield, Users } from 'lucide-react';
import type { WorkbenchNavigationItem } from './workbenchNavigation';

const baseAdminNavigation: WorkbenchNavigationItem[] = [
  { to: '/dashboard', label: '数据概览', description: '平台运营数据', Icon: BarChart3 },
  { to: '/admin/agents', label: 'Agent 审核', description: '审核入驻信息', Icon: Bot },
  { to: '/admin/arbitrations', label: '仲裁管理', description: '处理订单争议', Icon: Gavel },
  { to: '/admin/release', label: '放款管理', description: '处理资金放款', Icon: DollarSign },
  { to: '/admin/entitlement', label: 'AI 网关套餐', description: '订阅套餐与额度', Icon: CreditCard },
  { to: '/admin/platform-codes', label: '平台收款码', description: '维护收款配置', Icon: QrCode },
];

const superAdminNavigation: WorkbenchNavigationItem[] = [
  {
    to: '/admin/accounts',
    label: '管理员账号',
    description: '账号、权限与日志',
    Icon: Users,
  },
  {
    to: '/admin/sso-clients',
    label: 'SSO 接入方',
    description: '统一认证接入管理',
    Icon: KeyRound,
  },
];

export const getAdminWorkbenchNavigation = (level?: string) =>
  level === 'SUPER' ? [...baseAdminNavigation, ...superAdminNavigation] : baseAdminNavigation;

export const adminWorkbenchAccountNavigation: WorkbenchNavigationItem[] = [
  { to: '/admin/profile', label: '管理员中心', description: '身份、权限与安全', Icon: Shield },
];

export const isAdminWorkbenchNavigationItemActive = (pathname: string, target: string) =>
  pathname === target || pathname.startsWith(`${target}/`);

export const isAdminWorkbenchPath = (pathname: string) =>
  pathname === '/dashboard' || pathname.startsWith('/admin/');
