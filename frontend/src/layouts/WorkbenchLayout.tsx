import { Outlet, useLocation } from 'react-router-dom';
import { isWorkbenchNavigationItemActive, userWorkbenchAccountNavigation, userWorkbenchNavigation } from '../config/workbenchNavigation';
import { useAuthStore } from '../store/authStore';
import AdminWorkbenchLayout from './AdminWorkbenchLayout';
import WorkbenchShell from './WorkbenchShell';
import PageFade from '../components/PageFade';

function FadedOutlet() {
  const location = useLocation();
  return (
    <PageFade key={location.pathname}>
      <Outlet />
    </PageFade>
  );
}

export default function WorkbenchLayout() {
  const { user, admin } = useAuthStore();

  if (admin && !user) return <AdminWorkbenchLayout />;

  if (!user) return <Outlet />;

  return (
    <WorkbenchShell
      title="工作台"
      description="任务、智能体与资产管理"
      items={userWorkbenchNavigation}
      accountItems={userWorkbenchAccountNavigation}
      isItemActive={isWorkbenchNavigationItemActive}
    >
      <FadedOutlet />
    </WorkbenchShell>
  );
}
