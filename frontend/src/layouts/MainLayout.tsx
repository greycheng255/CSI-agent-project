import { Outlet, Link, NavLink, useNavigate } from 'react-router-dom';
import { Terminal, UserCircle, LogOut, FileText, Gavel, QrCode, DollarSign, CreditCard, TrendingUp, Shield, BarChart3, Users, Bot, Package, ClipboardList } from 'lucide-react';
import { useAuthStore } from '../store/authStore';

export default function MainLayout() {
  const { user, admin, logout, adminLogout } = useAuthStore();
  const navigate = useNavigate();

  const handleAdminLogout = () => {
    if (!window.confirm('确定要退出管理员登录吗？')) return;
    adminLogout();
    navigate('/login');
  };

  const handleLogout = () => {
    if (!window.confirm('确定要退出登录吗？')) return;
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
          
          <nav className="flex items-center space-x-4 text-sm whitespace-nowrap">
            <NavLink to="/market" className={({ isActive }) => `transition-colors flex-shrink-0 ${isActive ? 'text-green-400 font-semibold' : 'hover:text-green-400'}`}>任务大厅</NavLink>
            <NavLink to="/tasks/new" className={({ isActive }) => `transition-colors flex-shrink-0 ${isActive ? 'text-green-400 font-semibold' : 'hover:text-green-400'}`}>发布任务</NavLink>
            <NavLink to="/dashboard" className={({ isActive }) => `flex items-center gap-1 transition-colors flex-shrink-0 ${isActive ? 'text-green-400' : 'text-gray-400 hover:text-green-400'}`}>
              <BarChart3 className="w-3.5 h-3.5" />
              <span>仪表盘</span>
            </NavLink>
            <NavLink to="/api-docs" className={({ isActive }) => `flex items-center gap-1 transition-colors flex-shrink-0 ${isActive ? 'text-green-400' : 'text-gray-400 hover:text-green-400'}`}>
              <FileText className="w-3.5 h-3.5" />
              <span>API文档</span>
            </NavLink>
            <div className="w-px h-4 bg-gray-700 flex-shrink-0"></div>
            
            {/* 管理员登录状态 - 只显示管理员菜单 */}
            {admin && !user ? (
              <div className="flex items-center gap-3">
                <NavLink
                  to="/admin/arbitrations"
                  className={({ isActive }) => `text-sm transition-colors flex items-center gap-1 flex-shrink-0 ${isActive ? 'text-green-400 font-semibold' : 'text-yellow-400 hover:text-green-400'}`}
                >
                  <Gavel className="w-4 h-4" />
                  仲裁后台
                </NavLink>
                <NavLink
                  to="/admin/release"
                  className={({ isActive }) => `text-sm transition-colors flex items-center gap-1 flex-shrink-0 ${isActive ? 'text-green-400 font-semibold' : 'text-yellow-400 hover:text-green-400'}`}
                >
                  <DollarSign className="w-4 h-4" />
                  放款管理
                </NavLink>
                <NavLink
                  to="/admin/platform-codes"
                  className={({ isActive }) => `text-sm transition-colors flex items-center gap-1 flex-shrink-0 ${isActive ? 'text-green-400 font-semibold' : 'text-cyan-400 hover:text-green-400'}`}
                >
                  <QrCode className="w-4 h-4" />
                  平台收款码
                </NavLink>
                {admin.level === 'SUPER' && (
                  <NavLink
                    to="/admin/accounts"
                    className={({ isActive }) => `text-sm transition-colors flex items-center gap-1 flex-shrink-0 ${isActive ? 'text-green-400 font-semibold' : 'text-yellow-400 hover:text-green-400'}`}
                  >
                    <Users className="w-4 h-4" />
                    管理员管理
                  </NavLink>
                )}
                <div className="w-px h-4 bg-gray-700"></div>
                <Link to="/me" className="flex items-center space-x-2 text-yellow-400 hover:text-yellow-300 transition-colors">
                  <Shield className="w-5 h-5" />
                  <span className="text-sm">{admin.displayName || admin.username}</span>
                  <span className="px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 text-[10px] rounded border border-yellow-500/20">
                    {admin.level === 'SUPER' ? '超级管理员' : admin.level === 'OPERATOR' ? '运营' : '管理员'}
                  </span>
                </Link>
                <button
                  onClick={handleAdminLogout}
                  className="text-gray-500 hover:text-red-400 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : user ? (
              /* 普通用户登录状态 */
              <div className="flex items-center gap-3">
                {user.role === 'OWNER' && (
                  <>
                    <NavLink to="/owner/agents" className={({ isActive }) => `text-sm transition-colors flex items-center gap-1 flex-shrink-0 ${isActive ? 'text-green-400 font-semibold' : 'text-gray-400 hover:text-green-400'}`}>
                      <Bot className="w-4 h-4" />
                      我的Agent
                    </NavLink>
                    <NavLink to="/owner/bids" className={({ isActive }) => `text-sm transition-colors flex items-center gap-1 flex-shrink-0 ${isActive ? 'text-green-400 font-semibold' : 'text-gray-400 hover:text-green-400'}`}>
                      <TrendingUp className="w-4 h-4" />
                      我的报价
                    </NavLink>
                    <NavLink to="/orders/claimed" className={({ isActive }) => `text-sm transition-colors flex items-center gap-1 flex-shrink-0 ${isActive ? 'text-green-400 font-semibold' : 'text-gray-400 hover:text-green-400'}`}>
                      <Package className="w-4 h-4" />
                      我的接单
                    </NavLink>
                  </>
                )}
                <NavLink to="/orders/mine" className={({ isActive }) => `text-sm transition-colors flex items-center gap-1 flex-shrink-0 ${isActive ? 'text-green-400 font-semibold' : 'text-gray-400 hover:text-green-400'}`}>
                  <ClipboardList className="w-4 h-4" />
                  我的任务
                </NavLink>
                <NavLink to="/finance" className={({ isActive }) => `text-sm transition-colors flex items-center gap-1 flex-shrink-0 ${isActive ? 'text-green-400 font-semibold' : 'text-gray-400 hover:text-green-400'}`}>
                  <DollarSign className="w-4 h-4" />
                  我的收支
                </NavLink>
                <div className="w-px h-4 bg-gray-700"></div>
                <Link to="/me" className="flex items-center space-x-2 text-gray-300 hover:text-green-400 transition-colors">
                  <UserCircle className="w-5 h-5" />
                  <span className="text-sm">{user.displayName || user.phone}</span>
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
