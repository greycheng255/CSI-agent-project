import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, LogIn, Terminal } from 'lucide-react';
import { loginWithAccount } from '../services/auth.service';

export default function UnifiedLogin() {
  const navigate = useNavigate();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    const normalizedAccount = account.trim();
    if (!normalizedAccount || !password) {
      setError('请输入账号和密码');
      return;
    }

    setLoading(true);
    try {
      const result = await loginWithAccount(normalizedAccount, password);
      navigate(result.type === 'admin' ? '/admin/arbitrations' : '/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-md items-center px-2 py-10">
      <section className="w-full rounded-xl border border-gray-800 bg-[#080808] p-8 shadow-[0_8px_24px_rgba(0,0,0,0.28)]">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-green-500/25 bg-green-500/10 text-green-400">
            <Terminal className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-100">账号登录</h1>
          <p className="mt-2 text-sm leading-6 text-gray-400">
            完成凭证验证后继续访问 Genesis 平台
          </p>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5" autoComplete="off">
          <div>
            <label htmlFor="account" className="mb-2 block text-sm font-medium text-gray-300">
              账号
            </label>
            <input
              id="account"
              type="text"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              placeholder="请输入手机号或账号"
              autoComplete="username"
              className="w-full rounded-lg border border-gray-700 bg-black px-4 py-3 text-gray-100 outline-none transition-colors placeholder:text-gray-500 focus:border-green-500 focus:ring-2 focus:ring-green-500/15"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-2 block text-sm font-medium text-gray-300">
              密码
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
                className="w-full rounded-lg border border-gray-700 bg-black px-4 py-3 pr-11 text-gray-100 outline-none transition-colors placeholder:text-gray-500 focus:border-green-500 focus:ring-2 focus:ring-green-500/15"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 transition-colors hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500/30"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-green-500/40 bg-green-500/15 px-4 py-3 font-semibold text-green-300 transition-colors hover:bg-green-500/25 focus:outline-none focus:ring-2 focus:ring-green-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                正在验证
              </>
            ) : (
              <>
                <LogIn className="h-4 w-4" />
                继续
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-500">
          没有账号？{' '}
          <Link to="/register" className="text-green-400 transition-colors hover:text-green-300">
            创建账号
          </Link>
        </div>
      </section>
    </div>
  );
}
