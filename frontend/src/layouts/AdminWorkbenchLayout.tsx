import { Navigate, Outlet } from 'react-router-dom';
import { adminWorkbenchAccountNavigation, getAdminWorkbenchNavigation, isAdminWorkbenchNavigationItemActive } from '../config/adminWorkbenchNavigation';
import { useAuthStore } from '../store/authStore';
import WorkbenchShell from './WorkbenchShell';

export default function AdminWorkbenchLayout() {
  const { admin } = useAuthStore();

  if (!admin) return <Navigate to="/login" replace />;

  return (
    <WorkbenchShell
      title="管理工作台"
      description="平台运营、审核与资金管理"
      items={getAdminWorkbenchNavigation(admin.level)}
      accountItems={adminWorkbenchAccountNavigation}
      isItemActive={isAdminWorkbenchNavigationItemActive}
    >
      <Outlet />
    </WorkbenchShell>
  );
}
