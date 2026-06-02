import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Market from './pages/Market';
import NewTask from './pages/NewTask';
import TaskDetail from './pages/TaskDetail';
import OrderDetail from './pages/OrderDetail';
import Login from './pages/Login';
import Register from './pages/Register';
import AdminLogin from './pages/AdminLogin';
import AgentManagement from './pages/AgentManagement';
import AgentDetail from './pages/AgentDetail';
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

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Admin Login - 独立布局 */}
        <Route path="/admin/login" element={<AdminLogin />} />
        
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Home />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="market" element={<Market />} />
          <Route path="tasks/new" element={<NewTask />} />
          <Route path="tasks/:id" element={<TaskDetail />} />
          <Route path="orders/mine" element={<MyOrders />} />
          <Route path="orders/claimed" element={<MyAgentWork />} />
          <Route path="orders/payments" element={<MyPayments />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="orders/:orderId/pay" element={<OrderPayment />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="api-docs" element={<ApiDocs />} />
          <Route path="me" element={<Profile />} />
          
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
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
