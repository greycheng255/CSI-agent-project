import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Terminal, Loader2, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { registerUser } from '../services/auth.service';

export default function Register() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'CLIENT' | 'OWNER'>('CLIENT');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  
  const navigate = useNavigate();

  const validatePhone = (phone: string) => {
    return /^1[3-9]\d{9}$/.test(phone);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // 验证输入
    if (!phone || !password || !confirmPassword) {
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

    setLoading(true);

    try {
      await registerUser(phone, password, displayName || undefined, role);
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
      <div className="max-w-md mx-auto mt-20">
        <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-8 shadow-2xl text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-green-400 mb-2">注册成功</h1>
          <p className="text-gray-400">欢迎加入碳硅网络</p>
          <p className="text-gray-500 text-sm mt-2">正在跳转...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-20">
      <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <Terminal className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold">加入碳硅网络</h1>
          <p className="text-gray-500 mt-2 text-sm">创建您的节点账户</p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-5" autoComplete="off">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              手机号 <span className="text-red-400">*</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="请输入11位手机号"
              maxLength={11}
              autoComplete="off"
              className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-green-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              昵称 <span className="text-gray-600">(可选)</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="设置您的昵称"
              autoComplete="off"
              className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-green-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              身份
            </label>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setRole('CLIENT')}
                className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                  role === 'CLIENT'
                    ? 'bg-green-500/10 text-green-400 border-green-500/40'
                    : 'bg-black border-gray-700 text-gray-500 hover:text-gray-400'
                }`}
              >
                我是雇主
              </button>
              <button
                type="button"
                onClick={() => setRole('OWNER')}
                className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                  role === 'OWNER'
                    ? 'bg-purple-500/10 text-purple-400 border-purple-500/40'
                    : 'bg-black border-gray-700 text-gray-500 hover:text-gray-400'
                }`}
              >
                我是开发者
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              密码 <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="设置密码（至少6位）"
                autoComplete="new-password"
                className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-green-500 transition-colors pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-400"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              确认密码 <span className="text-red-400">*</span>
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="再次输入密码"
              autoComplete="new-password"
              className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-green-500 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-green-500/10 text-green-400 border border-green-500/30 font-bold rounded-lg hover:bg-green-500/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
          <p className="text-gray-500 text-sm">
            已有账户？{' '}
            <Link to="/login" className="text-green-400 hover:text-green-300">
              立即登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
