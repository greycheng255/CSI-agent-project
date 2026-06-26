import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Market from './pages/Market';
import AgentMarket from './pages/AgentMarket';
import AgentMarketHub from './pages/AgentMarketHub';
import AgentRun from './pages/AgentRun';
import NewTask from './pages/NewTask';
import TaskDetail from './pages/TaskDetail';
import OrderDetail from './pages/OrderDetail';
import UnifiedLogin from './pages/UnifiedLogin';
import Register from './pages/Register';
import AgentManagement from './pages/AgentManagement';
import AgentDetail from './pages/AgentDetail';
import AgentPublicDetail from './pages/AgentPublicDetail';
import AdminAgents from './pages/AdminAgents';
import AdminArbitrations from './pages/AdminArbitrations';
import ApiDocs from './pages/ApiDocs';
import MyOrders from './pages/MyOrders';
import MyAgentWork from './pages/MyAgentWork';
import PaymentCodes from './pages/PaymentCodes';
import OrderPayment from './pages/OrderPayment';
import AdminPlatformCodes from './pages/AdminPlatformCodes';
import AdminRelease from './pages/AdminRelease';
import MyReceipts from './pages/MyReceipts';
import MyPayments from './pages/MyPayments';
import MyBids from './pages/MyBids';
import Profile from './pages/Profile';
import AdminAccounts from './pages/AdminAccounts';
import FinanceManagement from './pages/FinanceManagement';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 统一登录页 - 已移除独立的 /admin/login */}

        <Route path="/" element={<MainLayout />}>
          <Route index element={<Home />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="market" element={<Market />} />
          <Route path="agents" element={<AgentMarket />} />
          <Route path="agents/:id" element={<AgentPublicDetail />} />
          <Route path="agent-market" element={<AgentMarketHub />} />
          <Route path="agent-market/:id" element={<AgentRun />} />
          <Route path="tasks/new" element={<NewTask />} />
          <Route path="tasks/:id" element={<TaskDetail />} />
          <Route path="orders/mine" element={<MyOrders />} />
          <Route path="orders/claimed" element={<MyAgentWork />} />
          <Route path="orders/payments" element={<MyPayments />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="orders/:orderId/pay" element={<OrderPayment />} />
          <Route path="login" element={<UnifiedLogin />} />
          <Route path="register" element={<Register />} />
          <Route path="api-docs" element={<ApiDocs />} />
          <Route path="me" element={<Profile />} />

          <Route path="finance" element={<FinanceManagement />} />

          {/* Owner (Agent) Routes */}
          <Route path="owner/agents" element={<AgentManagement />} />
          <Route path="owner/agents/:id" element={<AgentDetail />} />
          <Route path="owner/payment-codes" element={<PaymentCodes />} />
          <Route path="owner/receipts" element={<MyReceipts />} />
          <Route path="owner/bids" element={<MyBids />} />

          {/* Admin Routes - 需要管理员登录 */}
          <Route path="admin/arbitrations" element={<AdminArbitrations />} />
          <Route path="admin/platform-codes" element={<AdminPlatformCodes />} />
          <Route path="admin/release" element={<AdminRelease />} />
          <Route path="admin/accounts" element={<AdminAccounts />} />
          <Route path="admin/agents" element={<AdminAgents />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
