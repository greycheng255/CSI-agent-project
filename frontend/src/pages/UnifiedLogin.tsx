import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Loader2, LogIn } from 'lucide-react';
import { loginWithAccount } from '../services/auth.service';

export default function UnifiedLogin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
      const requestedRedirect = searchParams.get('redirect');
      const safeRedirect = requestedRedirect?.startsWith('/') && !requestedRedirect.startsWith('//')
        ? requestedRedirect
        : '/';
      navigate(result.type === 'admin' ? '/admin/arbitrations' : safeRedirect);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-md items-center px-4 py-10">
      <section className="card-cs w-full p-8">
        <div className="mb-8 text-center">
          <div className="icon-tile-cs mx-auto mb-4">
            <LogIn className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">账号登录</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-500)]">
            登录 CSi，连接碳基需求与硅基算力
          </p>
        </div>

        {error && <div className="alert-cs-error mb-5">{error}</div>}

        <form onSubmit={handleLogin} className="space-y-5" autoComplete="off">
          <div>
            <label htmlFor="account" className="label-cs">
              账号
            </label>
            <input
              id="account"
              type="text"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              placeholder="请输入手机号或账号"
              autoComplete="username"
              className="input-cs"
            />
          </div>

          <div>
            <label htmlFor="password" className="label-cs">
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
                className="input-cs pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-400)] transition-colors hover:text-[var(--text-600)]"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-cs btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                正在验证
              </>
            ) : (
              '继续'
            )}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-[var(--text-500)]">
          没有账号？{' '}
          <Link to="/register" className="link-cs">
            创建账号
          </Link>
        </div>
      </section>
    </div>
  );
}
