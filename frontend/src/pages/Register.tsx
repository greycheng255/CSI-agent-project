import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { UserPlus, Loader2, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { registerUser, sendSmsCode } from '../services/auth.service';

export default function Register() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [debugCodeEnabled, setDebugCodeEnabled] = useState(import.meta.env.DEV);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  
  const navigate = useNavigate();

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const validatePhone = (phone: string) => {
    return /^1[3-9]\d{9}$/.test(phone);
  };

  const handleSendCode = async () => {
    setError('');
    if (!validatePhone(phone)) {
      setError('请输入正确的手机号');
      return;
    }

    setSendingCode(true);
    try {
      const result = await sendSmsCode(phone, 'register');
      setCountdown(result.retryAfterSeconds);
      setDebugCodeEnabled(result.debugCodeEnabled);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '验证码发送失败，请稍后重试');
    } finally {
      setSendingCode(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // 验证输入
    if (!phone || !password || !confirmPassword || !verificationCode) {
      setError('请填写所有必填项');
      return;
    }

    if (!validatePhone(phone)) {
      setError('请输入正确的手机号');
      return;
    }

    if (password.length < 6) {
      setError('密码长度至少6位');
      return;
    }

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    if (!/^\d{6}$/.test(verificationCode)) {
      setError('请输入6位短信验证码');
      return;
    }

    setLoading(true);

    try {
      await registerUser(phone, password, verificationCode, displayName || undefined);

      setSuccess(true);
      
      // 2秒后跳转到首页
      setTimeout(() => {
        navigate('/');
      }, 2000);
      
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '注册失败，请稍后重试';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-md mx-auto px-4 py-20">
        <div className="card-cs p-8 text-center">
          <CheckCircle className="w-16 h-16 mx-auto mb-4 text-[var(--state-success)]" />
          <h1 className="text-2xl font-bold text-[var(--foreground)] mb-2">注册成功</h1>
          <p className="text-[var(--text-500)]">欢迎加入 CSi</p>
          <p className="text-[var(--text-400)] text-sm mt-2">正在跳转...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <div className="card-cs p-8">
        <div className="text-center mb-8">
          <div className="icon-tile-cs mx-auto mb-4">
            <UserPlus className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">加入 CSi</h1>
          <p className="text-[var(--text-500)] mt-2 text-sm">创建账号，发布需求或接入智能体</p>
        </div>

        {error && <div className="alert-cs-error mb-6">{error}</div>}

        <form onSubmit={handleRegister} className="space-y-5" autoComplete="off">
          <div>
            <label className="label-cs">
              手机号 <span className="text-[var(--state-error)]">*</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="请输入11位手机号"
              maxLength={11}
              autoComplete="off"
              className="input-cs"
            />
          </div>

          <div>
            <label className="label-cs">
              短信验证码 <span className="text-[var(--state-error)]">*</span>
            </label>
            <div className="flex gap-3">
              <input
                type="text"
                inputMode="numeric"
                value={verificationCode}
                onChange={e => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="请输入6位验证码"
                maxLength={6}
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

          <div>
            <label className="label-cs">
              昵称 <span className="text-[var(--text-400)]">(可选)</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="设置您的昵称"
              autoComplete="off"
              className="input-cs"
            />
          </div>

          <div>
            <label className="label-cs">
              密码 <span className="text-[var(--state-error)]">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="设置密码（至少6位）"
                autoComplete="new-password"
                className="input-cs pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-400)] transition-colors hover:text-[var(--text-600)]"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="label-cs">
              确认密码 <span className="text-[var(--state-error)]">*</span>
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="再次输入密码"
              autoComplete="new-password"
              className="input-cs"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-cs btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                注册中...
              </>
            ) : (
              '注册'
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-[var(--text-500)] text-sm">
            已有账户？{' '}
            <Link to="/login" className="link-cs">
              立即登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
