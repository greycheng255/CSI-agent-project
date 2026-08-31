import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Loader2, LogIn } from 'lucide-react';
import {
  loginWithAccount,
  loginWithSms,
  sendSmsCode,
} from '../services/auth.service';

type LoginMode = 'password' | 'sms';

export default function UnifiedLogin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [mode, setMode] = useState<LoginMode>('password');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [debugCodeEnabled, setDebugCodeEnabled] = useState(import.meta.env.DEV);
  const [error, setError] = useState('');

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const validatePhone = (phone: string) => /^1[3-9]\d{9}$/.test(phone);

  const handleSendCode = async () => {
    const phone = account.trim();
    setError('');
    if (!validatePhone(phone)) {
      setError('请输入正确的11位手机号');
      return;
    }

    setSendingCode(true);
    try {
      const result = await sendSmsCode(phone, 'login');
      setCountdown(result.retryAfterSeconds);
      setDebugCodeEnabled(result.debugCodeEnabled);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '验证码发送失败，请稍后重试');
    } finally {
      setSendingCode(false);
    }
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    const normalizedAccount = account.trim();
    if (mode === 'password' && (!normalizedAccount || !password)) {
      setError('请输入账号和密码');
      return;
    }
    if (mode === 'sms' && !validatePhone(normalizedAccount)) {
      setError('请输入正确的11位手机号');
      return;
    }
    if (mode === 'sms' && !/^\d{6}$/.test(verificationCode)) {
      setError('请输入6位短信验证码');
      return;
    }

    setLoading(true);
    try {
      const requestedRedirect = searchParams.get('redirect');
      const safeRedirect = requestedRedirect?.startsWith('/') && !requestedRedirect.startsWith('//')
        ? requestedRedirect
        : '/';
      if (mode === 'sms') {
        await loginWithSms(normalizedAccount, verificationCode);
        navigate(safeRedirect);
      } else {
        const result = await loginWithAccount(normalizedAccount, password);
        navigate(result.type === 'admin' ? '/admin/arbitrations' : safeRedirect);
      }
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
          <h1 className="text-2xl font-bold text-[var(--foreground)]">登录 CSi</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-500)]">
            登录 CSi，连接碳基需求与硅基算力
          </p>
        </div>

        {error && <div className="alert-cs-error mb-5">{error}</div>}

        <div className="mb-5 grid grid-cols-2 rounded-lg bg-[var(--background-100)] p-1">
          {(['password', 'sms'] as const).map((loginMode) => (
            <button
              key={loginMode}
              type="button"
              onClick={() => {
                setMode(loginMode);
                setError('');
              }}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === loginMode
                  ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm'
                  : 'text-[var(--text-500)] hover:text-[var(--foreground)]'
              }`}
            >
              {loginMode === 'password' ? '密码登录' : '短信登录'}
            </button>
          ))}
        </div>

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
              placeholder={mode === 'password' ? '请输入手机号或管理员账号' : '请输入11位手机号'}
              autoComplete="username"
              maxLength={mode === 'sms' ? 11 : undefined}
              className="input-cs"
            />
          </div>

          {mode === 'password' ? <div>
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
          </div> : (
            <div>
              <label htmlFor="verification-code" className="label-cs">
                短信验证码
              </label>
              <div className="flex gap-3">
                <input
                  id="verification-code"
                  type="text"
                  inputMode="numeric"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="请输入6位验证码"
                  autoComplete="one-time-code"
                  className="input-cs min-w-0 flex-1"
                />
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={sendingCode || countdown > 0}
                  className="btn-cs btn-secondary shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sendingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : countdown > 0 ? `${countdown}s` : '获取验证码'}
                </button>
              </div>
              {debugCodeEnabled && (
                <p className="mt-2 text-xs text-[var(--text-400)]">
                  调试模式可直接使用验证码 121212
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-cs btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                正在登录
              </>
            ) : (
              '登录'
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
