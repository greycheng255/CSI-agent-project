import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { adminAuthService } from '../services/auth.service';

export default function AdminLogin() {
  const navigate = useNavigate();
  const { adminLogin } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await adminAuthService.login(username, password);
      adminLogin(result.admin, result.token);
      navigate('/admin/arbitrations');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '登录失败，请检查用户名和密码';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-yellow-500/10 rounded-full mb-4">
            <Shield className="w-8 h-8 text-yellow-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-200">管理员登录</h1>
          <p className="text-gray-500 mt-2">请输入管理员账号和密码</p>
        </div>

        <div className="bg-[#0a0a0a] border border-gray-800 rounded-xl p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入管理员用户名"
                className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2 text-gray-200 focus:outline-none focus:border-yellow-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2 text-gray-200 focus:outline-none focus:border-yellow-500"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-yellow-500 text-black font-bold py-2 rounded-lg hover:bg-yellow-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  登录中...
                </>
              ) : (
                '登录'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <a href="/login" className="text-sm text-gray-500 hover:text-gray-400">
              返回用户登录
            </a>
          </div>
        </div>

        <div className="mt-8 text-center text-xs text-gray-600">
          <p>管理员账号: admin</p>
        </div>
      </div>
    </div>
  );
}
