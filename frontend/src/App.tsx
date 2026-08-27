import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import WorkbenchLayout from './layouts/WorkbenchLayout';

const Home = lazy(() => import('./pages/Home'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Market = lazy(() => import('./pages/Market'));
const AgentMarket = lazy(() => import('./pages/AgentMarket'));
const AgentMarketHub = lazy(() => import('./pages/AgentMarketHub'));
const AgentRun = lazy(() => import('./pages/AgentRun'));
const NewTask = lazy(() => import('./pages/NewTask'));
const TaskDetail = lazy(() => import('./pages/TaskDetail'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const UnifiedLogin = lazy(() => import('./pages/UnifiedLogin'));
const Register = lazy(() => import('./pages/Register'));
const AgentManagement = lazy(() => import('./pages/AgentManagement'));
const AgentDetail = lazy(() => import('./pages/AgentDetail'));
const AgentPublicDetail = lazy(() => import('./pages/AgentPublicDetail'));
const AdminAgents = lazy(() => import('./pages/AdminAgents'));
const AdminArbitrations = lazy(() => import('./pages/AdminArbitrations'));
const ApiDocs = lazy(() => import('./pages/ApiDocs'));
const MyOrders = lazy(() => import('./pages/MyOrders'));
const MyAgentWork = lazy(() => import('./pages/MyAgentWork'));
const OrderPayment = lazy(() => import('./pages/OrderPayment'));
const AdminPlatformCodes = lazy(() => import('./pages/AdminPlatformCodes'));
const AdminRelease = lazy(() => import('./pages/AdminRelease'));
const MyBids = lazy(() => import('./pages/MyBids'));
const Profile = lazy(() => import('./pages/Profile'));
const AdminAccounts = lazy(() => import('./pages/AdminAccounts'));
const FinanceManagement = lazy(() => import('./pages/FinanceManagement'));

function PageFallback() {
  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5" aria-label="正在加载页面">
      <div className="h-20 animate-pulse rounded-2xl bg-[var(--background-100)]" />
      <div className="h-72 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* 统一登录页 - 已移除独立的 /admin/login */}

        <Route path="/" element={<MainLayout />}>
          <Route index element={<Home />} />
          <Route path="market" element={<Market />} />
          <Route path="agents" element={<AgentMarket />} />
          <Route path="agents/:id" element={<AgentPublicDetail />} />
          <Route path="agent-market" element={<AgentMarketHub />} />
          <Route path="agent-market/:id" element={<AgentRun />} />
          <Route path="tasks/new" element={<NewTask />} />
          <Route path="tasks/:id" element={<TaskDetail />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="orders/:orderId/pay" element={<OrderPayment />} />
          <Route path="login" element={<UnifiedLogin />} />
          <Route path="register" element={<Register />} />
          <Route path="api-docs" element={<ApiDocs />} />

          {/* 工作台：顶部主导航保持不变，子菜单在内容区左侧展示 */}
          <Route element={<WorkbenchLayout />}>
            <Route path="me" element={<Profile />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="orders/mine" element={<MyOrders />} />
            <Route path="orders/claimed" element={<MyAgentWork />} />
            <Route path="orders/payments" element={<Navigate to="/finance?tab=payments" replace />} />
            <Route path="finance" element={<FinanceManagement />} />
            <Route path="owner/agents" element={<AgentManagement />} />
            <Route path="owner/agents/:id" element={<AgentDetail />} />
            <Route path="owner/payment-codes" element={<Navigate to="/finance?tab=codes" replace />} />
            <Route path="owner/receipts" element={<Navigate to="/finance?tab=receipts" replace />} />
            <Route path="owner/bids" element={<MyBids />} />
            <Route path="admin/profile" element={<Profile />} />

            {/* 管理员工作台：管理员登录时复用同一工作台外壳 */}
            <Route path="admin/arbitrations" element={<AdminArbitrations />} />
            <Route path="admin/platform-codes" element={<AdminPlatformCodes />} />
            <Route path="admin/release" element={<AdminRelease />} />
            <Route path="admin/accounts" element={<AdminAccounts />} />
            <Route path="admin/agents" element={<AdminAgents />} />
          </Route>
        </Route>
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
