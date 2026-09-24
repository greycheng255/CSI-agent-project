import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Loader2, LogIn } from 'lucide-react';
import {
  getSsoAuthorizeUrl,
  loginWithAccount,
  loginWithSms,
  sendSmsCode,
} from '../services/auth.service';
import { useAuthStore } from '../store/authStore';

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
  const [ssoLoading, setSsoLoading] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  // SSO 单点：已登录状态下携带 ?redirect= 进入登录页时，直接续跳（无需重复登录）
  useEffect(() => {
    const requested = searchParams.get('redirect');
    const safe = requested?.startsWith('/') && !requested.startsWith('//') ? requested : null;
    if (safe && useAuthStore.getState().isLoggedIn()) {
      navigate(safe, { replace: true });
    }
  }, [searchParams, navigate]);

  const validatePhone = (phone: string) => /^1[3-9]\d{9}$/.test(phone);

  /** Casdoor SSO 登录：生成 state 防 CSRF，记下续跳目标，跳 Casdoor authorize */
  const handleSsoLogin = async () => {
    setError('');
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const state = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const requestedRedirect = searchParams.get('redirect');
    const safeRedirect =
      requestedRedirect?.startsWith('/') && !requestedRedirect.startsWith('//')
        ? requestedRedirect
        : '/';
    sessionStorage.setItem('csi_sso_state', state);
    sessionStorage.setItem('csi_sso_redirect', safeRedirect);

    setSsoLoading(true);
    try {
      const { authorizeUrl } = await getSsoAuthorizeUrl(
        `${window.location.origin}/callback`,
        state,
      );
      window.location.href = authorizeUrl;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'SSO 跳转失败，请稍后重试');
      setSsoLoading(false);
    }
  };

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
      // 仅本地开发环境（DEV）才允许展示调试验证码；生产构建下始终为 false
      setDebugCodeEnabled(import.meta.env.DEV && result.debugCodeEnabled);
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
          <h1 className="text-2xl font-bold text-[var(--foreground)]">登录碳硅 Genesis</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-500)]">
            登录碳硅 Genesis，连接碳基需求与硅基算力
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
              {import.meta.env.DEV && debugCodeEnabled && (
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

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-[var(--border)]" />
          <span className="text-xs text-[var(--text-400)]">或</span>
          <div className="h-px flex-1 bg-[var(--border)]" />
        </div>

        <button
          type="button"
          onClick={handleSsoLogin}
          disabled={loading || ssoLoading}
          className="btn-cs btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
        >
          {ssoLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              正在跳转 SSO
            </>
          ) : (
            'SSO 登录（Casdoor）'
          )}
        </button>

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
