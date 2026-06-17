import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Terminal, Shield, Eye, EyeOff, Loader2 } from 'lucide-react';
import { loginUser, adminAuthService } from '../services/auth.service';

type LoginTab = 'user' | 'admin';

export default function UnifiedLogin() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<LoginTab>('user');

  // 用户登录表单
  const [phone, setPhone] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [showUserPassword, setShowUserPassword] = useState(false);

  // 管理员登录表单
  const [username, setUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  // 通用状态
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleUserLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!phone || !userPassword) {
      setError('请输入手机号和密码');
      return;
    }

    setLoading(true);
    try {
      await loginUser(phone, userPassword);
      navigate('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '登录失败，请检查手机号和密码';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username || !adminPassword) {
      setError('请输入用户名和密码');
      return;
    }

    setLoading(true);
    try {
      await adminAuthService.login(username, adminPassword);
      navigate('/admin/arbitrations');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '登录失败，请检查用户名和密码';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // 切换 Tab 时清除错误
  const switchTab = (tab: LoginTab) => {
    setActiveTab(tab);
    setError('');
  };

  return (
    <div className="max-w-md mx-auto mt-16">
      {/* 标题 */}
      <div className="text-center mb-8">
        <Terminal className="w-12 h-12 text-green-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold">接入碳硅网络</h1>
        <p className="text-gray-500 mt-2 text-sm">请选择您的身份凭证进行验证</p>
      </div>

      {/* Tab 切换 */}
      <div className="flex border border-gray-800 rounded-lg overflow-hidden mb-6">
        <button
          type="button"
          onClick={() => switchTab('user')}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            activeTab === 'user'
              ? 'bg-green-500/10 text-green-400 border-b-2 border-green-500'
              : 'text-gray-500 hover:text-gray-400'
          }`}
        >
          <Terminal className="w-4 h-4 inline mr-1.5" />
          用户登录
        </button>
        <button
          type="button"
          onClick={() => switchTab('admin')}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            activeTab === 'admin'
              ? 'bg-yellow-500/10 text-yellow-400 border-b-2 border-yellow-500'
              : 'text-gray-500 hover:text-gray-400'
          }`}
        >
          <Shield className="w-4 h-4 inline mr-1.5" />
          管理员登录
        </button>
      </div>

      {/* 登录卡片 */}
      <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-8 shadow-2xl">
        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* 用户登录表单 */}
        {activeTab === 'user' && (
          <form onSubmit={handleUserLogin} className="space-y-6" autoComplete="off">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                手机号
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="请输入手机号"
                autoComplete="off"
                className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                密码
              </label>
              <div className="relative">
                <input
                  type={showUserPassword ? 'text' : 'password'}
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  placeholder="请输入密码"
                  autoComplete="new-password"
                  className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-green-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowUserPassword(!showUserPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-400"
                >
                  {showUserPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-green-500/10 text-green-400 border border-green-500/30 font-bold rounded-lg hover:bg-green-500/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  验证中...
                </>
              ) : (
                '登录'
              )}
            </button>
            <div className="text-center">
              <Link
                to="/register"
                className="text-sm text-gray-500 hover:text-green-400 transition-colors"
              >
                还没有账号？立即注册
              </Link>
            </div>
          </form>
        )}

        {/* 管理员登录表单 */}
        {activeTab === 'admin' && (
          <form onSubmit={handleAdminLogin} className="space-y-6" autoComplete="off">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                用户名
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入管理员用户名"
                autoComplete="off"
                className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-yellow-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                密码
              </label>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="请输入密码"
                autoComplete="new-password"
                className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-yellow-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-yellow-500 text-black font-bold rounded-lg hover:bg-yellow-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  验证中...
                </>
              ) : (
                '管理员登录'
              )}
            </button>
          </form>
        )}
      </div>

      <div className="mt-6 text-center text-xs text-gray-600">
        <p>Project Genesis · 碳硅商业交易网络</p>
      </div>
    </div>
  );
}
