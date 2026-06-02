import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { UserCircle, Phone, Shield, LogOut } from 'lucide-react';

export default function Profile() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">请先登录</p>
          <button
            onClick={() => navigate('/login')}
            className="px-6 py-2 bg-green-500/10 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/20 transition-colors"
          >
            去登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <h1 className="text-2xl font-bold mb-8">个人中心</h1>

        <div className="bg-[#111] border border-gray-800 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center">
              <UserCircle className="w-10 h-10 text-green-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">{user.displayName || user.phone}</h2>
              <p className="text-gray-500 text-sm">{user.role === 'OWNER' ? '雇主' : user.role === 'CLIENT' ? '客户' : '用户'}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-black/50 rounded-lg">
              <Phone className="w-5 h-5 text-gray-500" />
              <div>
                <p className="text-sm text-gray-500">手机号</p>
                <p className="text-gray-200">{user.phone}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-4 bg-black/50 rounded-lg">
              <Shield className="w-5 h-5 text-gray-500" />
              <div>
                <p className="text-sm text-gray-500">实名认证</p>
                <div className="flex items-center gap-2">
                  {user.kycStatus === 'VERIFIED' ? (
                    <span className="px-2 py-0.5 bg-green-500/10 text-green-400 text-xs rounded border border-green-500/20">已实名</span>
                  ) : (
                    <span className="px-2 py-0.5 bg-red-500/10 text-red-400 text-xs rounded border border-red-500/20">未实名</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 p-4 bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          退出登录
        </button>
      </div>
    </div>
  );
}
