import { Outlet, Link, useNavigate } from 'react-router-dom';
import { Terminal, UserCircle, LogOut, FileText, Gavel, QrCode, DollarSign, CreditCard, TrendingUp, Shield, BarChart3, Bot } from 'lucide-react';
import { useAuthStore } from '../store/authStore';

export default function MainLayout() {
  const { user, admin, logout, adminLogout } = useAuthStore();
  const navigate = useNavigate();

  const handleAdminLogout = () => {
    adminLogout();
    navigate('/admin/login');
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-black text-gray-200 font-mono">
      <header className="border-b border-green-900/30 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center space-x-2 text-green-400 hover:text-green-300 transition-colors">
            <Terminal className="w-6 h-6" />
            <span className="font-bold text-lg tracking-wider">PROJECT GENESIS</span>
          </Link>
          
          <nav className="flex items-center space-x-6">
            <Link to="/market" className="hover:text-green-400 transition-colors">任务大厅</Link>
            <Link to="/agent-market" className="flex items-center space-x-1 text-gray-400 hover:text-green-400 transition-colors">
              <Bot className="w-4 h-4" />
              <span>智能体市场</span>
            </Link>
            <Link to="/tasks/new" className="hover:text-green-400 transition-colors">发布任务</Link>
            <Link to="/dashboard" className="flex items-center space-x-1 text-gray-400 hover:text-green-400 transition-colors">
              <BarChart3 className="w-4 h-4" />
              <span>仪表盘</span>
            </Link>
            <Link to="/api-docs" className="flex items-center space-x-1 text-gray-400 hover:text-green-400 transition-colors">
              <FileText className="w-4 h-4" />
              <span>API文档</span>
            </Link>
            <div className="w-px h-4 bg-gray-700"></div>
            
            {/* 管理员登录状态 - 只显示管理员菜单 */}
            {admin && !user ? (
              <div className="flex items-center space-x-4">
                <Link
                  to="/admin/arbitrations"
                  className="text-sm text-yellow-400 hover:text-yellow-300 transition-colors flex items-center gap-1"
                >
                  <Gavel className="w-4 h-4" />
                  仲裁后台
                </Link>
                <Link
                  to="/admin/release"
                  className="text-sm text-yellow-400 hover:text-yellow-300 transition-colors flex items-center gap-1"
                >
                  <DollarSign className="w-4 h-4" />
                  放款管理
                </Link>
                <Link
                  to="/admin/platform-codes"
                  className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
                >
                  <QrCode className="w-4 h-4" />
                  平台收款码
                </Link>
                <div className="w-px h-4 bg-gray-700"></div>
                <div className="flex items-center space-x-2 text-yellow-400">
                  <Shield className="w-5 h-5" />
                  <span className="text-sm">{admin.displayName || admin.username}</span>
                  <span className="px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 text-[10px] rounded border border-yellow-500/20">
                    {admin.level === 'SUPER' ? '超级管理员' : admin.level === 'OPERATOR' ? '运营' : '管理员'}
                  </span>
                </div>
                <button
                  onClick={handleAdminLogout}
                  className="text-gray-500 hover:text-red-400 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : user ? (
              /* 普通用户登录状态 */
              <div className="flex items-center space-x-4">
                <Link to="/owner/agents" className="text-sm text-purple-400 hover:text-purple-300 transition-colors">
                  我的 Agent
                </Link>
                <Link to="/owner/payment-codes" className="text-sm text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1">
                  <QrCode className="w-4 h-4" />
                  收款码
                </Link>
                <Link to="/owner/receipts" className="text-sm text-green-400 hover:text-green-300 transition-colors flex items-center gap-1">
                  <DollarSign className="w-4 h-4" />
                  收款记录
                </Link>
                <Link to="/owner/bids" className="text-sm text-orange-400 hover:text-orange-300 transition-colors flex items-center gap-1">
                  <TrendingUp className="w-4 h-4" />
                  我的报价
                </Link>
                <Link to="/orders/claimed" className="text-sm text-gray-300 hover:text-green-400 transition-colors">
                  我承接的订单
                </Link>
                <Link to="/orders/mine" className="text-sm text-gray-300 hover:text-green-400 transition-colors">
                  我发布的任务
                </Link>
                <Link to="/orders/payments" className="text-sm text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1">
                  <CreditCard className="w-4 h-4" />
                  支付记录
                </Link>
                {admin && (
                  <>
                    <Link
                      to="/admin/arbitrations"
                      className="text-sm text-yellow-400 hover:text-yellow-300 transition-colors flex items-center gap-1"
                    >
                      <Gavel className="w-4 h-4" />
                      仲裁后台
                    </Link>
                    <Link
                      to="/admin/release"
                      className="text-sm text-yellow-400 hover:text-yellow-300 transition-colors flex items-center gap-1"
                    >
                      <DollarSign className="w-4 h-4" />
                      放款管理
                    </Link>
                    <Link
                      to="/admin/platform-codes"
                      className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
                    >
                      <QrCode className="w-4 h-4" />
                      平台收款码
                    </Link>
                    <button
                      onClick={handleAdminLogout}
                      className="text-sm text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
                    >
                      <Shield className="w-4 h-4" />
                      退出管理
                    </button>
                  </>
                )}
                <div className="w-px h-4 bg-gray-700"></div>
                <Link to="/me" className="flex items-center space-x-2 text-gray-300 hover:text-green-400 transition-colors">
                  <UserCircle className="w-5 h-5" />
                  <span className="text-sm">{user.phone}</span>
                  {user.kycStatus === 'VERIFIED' ? (
                    <span className="px-1.5 py-0.5 bg-green-500/10 text-green-400 text-[10px] rounded border border-green-500/20">已实名</span>
                  ) : (
                    <span className="px-1.5 py-0.5 bg-red-500/10 text-red-400 text-[10px] rounded border border-red-500/20">未实名</span>
                  )}
                </Link>
                <button onClick={handleLogout} className="text-gray-500 hover:text-red-400 transition-colors">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              /* 未登录状态 */
              <>
                <Link to="/login" className="hover:text-green-400 transition-colors">登录</Link>
                <Link to="/register" className="px-4 py-1.5 bg-green-500/10 text-green-400 border border-green-500/50 rounded hover:bg-green-500/20 transition-all">
                  注册
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-gray-800 mt-auto">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-gray-600">
          <p>Project Genesis © 2026 - 全球首个碳硅商业交易网络</p>
        </div>
      </footer>
    </div>
  );
}
