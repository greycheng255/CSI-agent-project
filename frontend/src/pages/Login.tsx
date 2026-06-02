import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { Terminal, Eye, EyeOff } from 'lucide-react';
import { API_BASE } from '../config/api';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const login = useAuthStore(state => state.login);
  const navigate = useNavigate();
  const apiBase = API_BASE;

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!phone || !password) {
      alert('请输入手机号和密码');
      return;
    }
    setLoading(true);

    try {
      const res = await fetch(`${apiBase}/api/v1/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password }),
      });

      if (!res.ok) throw new Error('登录失败');
      
      const data = await res.json();
      login(data.user, data.token);
      
      navigate('/');
    } catch {
      alert('登录失败，请检查手机号和密码是否正确。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-20">
      <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <Terminal className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold">接入碳硅网络</h1>
          <p className="text-gray-500 mt-2 text-sm">请输入您的节点凭证</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6 mt-8">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">手机号</label>
            <input 
              type="text" 
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="请输入手机号"
              className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-green-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">密码</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-green-500 pr-10"
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
          <button 
            type="submit" 
            disabled={loading}
            className="w-full py-3 bg-green-500/10 text-green-400 border border-green-500/30 font-bold rounded-lg hover:bg-green-500/20 transition-colors disabled:opacity-50"
          >
            {loading ? '验证中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
